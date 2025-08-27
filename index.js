/**
 * According to this page:
 * https://developer.vonage.com/en/vonage-cloud-runtime/providers/scheduler?source=vonage-cloud-runtime
 * 
 * Cron also works in VCR.
 * This is what we're using here.
 * 
 * TO RUN: node index.js
 * And let the cron reaches 3 AM
 * 
 * TO RUN NOW: node index.js --now
 * Runs now
 */
import express from 'express';
import * as fs from 'fs';                   
import * as fsPromises from 'fs/promises';  
import path from 'path';
import fetch from 'node-fetch';
import * as Utils from './utils.js';

const app = express();
const PORT =  process.env.VCR_PORT || 3000;

// CONFIG - Uses values for the account in VCR
const API_KEY = process.env.VCR_API_ACCOUNT_ID;
const API_SECRET = process.env.VCR_API_ACCOUNT_SECRET;
const ACCOUNT_ID = process.env.VCR_API_ACCOUNT_ID;
const DOWNLOAD_DIR = path.resolve('./data');
const PUSH_URL = 'https://neru-cb28378f-marketing-cloud-apis-dev.euw1.runtime.vonage.cloud/tracking/bulk';

/**
 * THIS IS THE MAIN FUNCTION
 * RUNNING AS SCHEDULED
 */
async function runJob() {
    try {
        const { startDate, endDate } = getYesterdayRange();
        console.log(`Fetching report for: ${startDate}`);

        //  Generate the report with Vonage Reports API
        const requestId = await generateReport(startDate, endDate);
        const fileId = await pollReportStatus(requestId);
        const filePath = await downloadCSV(fileId, startDate);
        const records = parseCSV(filePath);
        console.log('Total records to process: ' + records?.length)

        //  Process the CSV
        await processArrayWithSleep(records.slice(1));
        console.log('Job complete!');

        // Rename CSV file to prevent reprocessing
        const donePath = filePath + '.done';
        await fsPromises.rename(filePath, donePath);
        console.log(`Renamed CSV to: ${donePath}`);

    } catch (err) {
        console.error('Job failed:', err.message);
    }
}

// 1. Generate Report
async function generateReport(startDate, endDate) {
    const username = API_KEY ;
    const password = API_SECRET;
    const basicAuth = Buffer.from(`${username}:${password}`).toString('base64');

    const headers = {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/json',
    };

    const requestPayload = {
        product: 'MESSAGES',
        account_id: ACCOUNT_ID,
        direction: 'outbound',
        date_start: `${startDate}T00:00:00+00:00`,
        date_end: `${endDate}T23:59:59+00:00`,
        include_subaccounts: 'false',
        include_message: 'false',
    };

    const res = await fetch('https://api.nexmo.com/v2/reports', {
        method: 'POST',
        headers,
        body: JSON.stringify(requestPayload),
    });

    const json = await res.json();
    console.log('Response', json)
    return json.request_id; 
}

// 2. Poll Status
async function pollReportStatus(requestId) {
    const username = API_KEY;
    const password = API_SECRET;
    const basicAuth = Buffer.from(`${username}:${password}`).toString('base64');

    const statusUrl = `https://api.nexmo.com/v2/reports/${requestId}`;

    //  We try 30 times to get the report
    for (let attempt = 0; attempt < 30; attempt++) {
        const res = await fetch(statusUrl, {
            headers: {
                'Authorization': `Basic ${basicAuth}`,
                'Content-Type': 'application/json',
            }
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Error checking report status: ${res.status} ${errText}`);
        }

        const json = await res.json();
        console.log('Response Status', json);
        console.log(`Attempt ${attempt + 1}: status = ${json.request_status}`);

        if (json.request_status === 'SUCCESS' && json._links?.download_report?.href) {
            const url = json._links.download_report.href;
            const fileId = url.split('/').pop();
            return fileId;
        }

        await sleep(5000); // wait 5 seconds before retrying
    }
    throw new Error('Timed out waiting for report to be ready');
}

// 3. Download CSV
async function downloadCSV(fileId, dateLabel) {
    const url = `https://api.nexmo.com/v3/media/${fileId}`;
    const basicAuth = Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64');

    const res = await fetch(url, {
        headers: { Authorization: `Basic ${basicAuth}` }
    });

    const buffer = Buffer.from(await res.arrayBuffer());
    const zipPath = path.join(DOWNLOAD_DIR, `${dateLabel}.zip`);
    await fsPromises.writeFile(zipPath, buffer);

    // Unzip to same dir
    const { default: unzipper } = await import('unzipper');
    await fs.createReadStream(zipPath)
        .pipe(unzipper.Extract({ path: DOWNLOAD_DIR }))
        .promise();

    // Delete ZIP after successful unzip
    await fsPromises.unlink(zipPath);
    console.log(`🧹 Deleted temporary ZIP: ${zipPath}`);

    // Find CSV
    console.log('DOWNLOAD_DIR', DOWNLOAD_DIR)
    const files = await fsPromises.readdir(DOWNLOAD_DIR);
    const csv = files.find(f => f.endsWith('.csv'));
    if (!csv) throw new Error('CSV not found after unzip');
    
    const fullPath = path.join(DOWNLOAD_DIR, csv);
    console.log(`Found CSV: ${fullPath}`);
    return fullPath;
}

// 4. Parse CSV
function parseCSV(filePath) {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    return fileContent.split('\n').map(row =>
        row.split(',').map(val => val.replace(/^"([^"]*)"$/, '$1'))
    );
}

// 5. Chunked Submission
async function processArrayWithSleep(arr) {
    const chunkSize = 500;
    let items = [];

    for (let i = 0; i < arr.length; i++) {
        const row = arr[i];
        if (row[11] === 'service') continue;

        items.push({
            to: row[5],
            from: row[4],
            channel: row[8],
            message_uuid: row[1],
            dateString: row[14],
            type: row[11],
            status: row[16],
        });

        if (items.length === chunkSize || i === arr.length - 1) {
            console.log(`Sending ${items.length} items...`);
            await sendRequest(items);
            items = [];
            await sleep(2000);
        }
    }
}

// POST to VCR
async function sendRequest(items) {
    const res = await fetch(PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(items)
    });

    const text = await res.text();
    console.log('Server response:', text.slice(0, 200));
}

//  CRON
app.get('/cron-runner', async (req, res) => {
    console.log('cron-runner called')
    // console.log('API_KEY', API_KEY);
    // console.log('API_SECRET', API_SECRET);
    // console.log('ACCOUNT_ID', ACCOUNT_ID);

    //  We run this every minute
    const now = new Date();
    const hours = now.getHours();   // 0–23
    const minutes = now.getMinutes(); // 0–59
    
    // Run only once at 03:00 (server local time)
    if (hours === 3 && minutes === 0) {
        await runJob();
    }

    // We call ourselves again in a minute
    Utils.callCronCheckAgain();

    //  Return
    res.json({ success: true, message: 'Checked and triggered eligible cron jobs' });
})



// Manual run (for debug)
if (process.argv.includes('--now')) runJob();

// Helpers
function getYesterdayRange() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const day = d.toISOString().split('T')[0];
    return { startDate: day, endDate: day };
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

app.get('/_/health', async (req, res) => {
    res.sendStatus(200)
})

app.listen(PORT, () => {
    console.log(`Server running on ${PORT}`);
    Utils.callCronCheckAgain();
});