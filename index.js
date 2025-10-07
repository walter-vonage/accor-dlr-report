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
import { sendReportEmail, sendReportEmailTo } from './send_email.js';

const app = express();
const PORT =  process.env.VCR_PORT || 3000;

// CONFIG - Uses values for the account in VCR
const API_KEY = process.env.VCR_API_ACCOUNT_ID;
const API_SECRET = process.env.VCR_API_ACCOUNT_SECRET;
const ACCOUNT_ID = process.env.VCR_API_ACCOUNT_ID;
const DOWNLOAD_DIR = path.resolve('./data');
const PUSH_URL = 'https://neru-cb28378f-marketing-cloud-apis-dev.euw1.runtime.vonage.cloud/tracking/bulk';

let isRunning = false;

/**
 * THIS IS THE MAIN FUNCTION
 * RUNNING AS SCHEDULED
 */
async function runJob() {
    if (isRunning) {
        console.warn('Job is already running. Skipping this trigger.');
        return;
    }
    isRunning = true;
    try {
        for (let retries = 0; retries < 3; retries++) {
            try {
                await doTheJob(); 
                await sendReportEmail('Accor process finished');
                break;
            } catch (err) {
                console.error(`Attempt ${retries + 1} failed: ${err.message}`);
                if (retries === 2) {
                    await sendReportEmail('Job failed!! -> ' + err.message);
                }
            }
        }
    } finally {
        isRunning = false;
    }
}

async function doTheJob(optionalDate) {
    // If a date was passed in, use it. Otherwise default to yesterday.
    const { startDate, endDate } = optionalDate
        ? { startDate: optionalDate, endDate: optionalDate }
        : getYesterdayRange();
    
    const logs = [];
    let log = `Fetching report for: ${startDate}`
    logs.push(log);
    console.log(log);

    //  Generate the report with Vonage Reports API
    const requestId = await generateReport(startDate, endDate);
    const fileId = await pollReportStatus(requestId);
    const filePath = await downloadCSV(fileId, startDate);
    const records = parseCSV(filePath);
    log = `Total records to process: ${records?.length}`
    logs.push(log);
    console.log(log)

    //  Process the CSV
    await processArrayWithSleep(records.slice(1));    
    log = `Job complete!`;
    logs.push(log);
    console.log(log);

    // Rename CSV file to prevent reprocessing
    const donePath = filePath + '.done';
    await fsPromises.rename(filePath, donePath);
    log = `Renamed CSV to: ${donePath}`;
    logs.push(log);
    console.log('log')
    
    return logs;
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

/**
 * Call this from a brwoser to start the cron jon
 */
app.get('/run-job', async (req, res) => {
    if (isRunning) {
        return res.status(409).json({ success: false, message: 'Job is already running.' });
    }
    try {
        await runJob(); // Wait for job to finish
        res.json({ success: true, message: 'Job completed (or attempted).' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Job failed', error: err.message });
    }
})

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

/**
 * CHECK THE STATUS OF OUR CROn JOb
 */
app.get('/cron-status', async (req, res) => {
    try {
        const pathToHeartbeat = path.resolve('./cron-heartbeat.txt');
        const lastHeartbeat = fs.readFileSync(pathToHeartbeat, 'utf-8');
        const lastDate = new Date(lastHeartbeat);
        const now = new Date();

        const diffMinutes = Math.floor((now - lastDate) / 1000 / 60);

        const running = diffMinutes < 3; // consider "dead" if no heartbeat in last 3 min
        const ageMinutes = diffMinutes;
        res.send(`<table border="1" cellpadding="5">
            <tr>
                <td><strong>Running:</strong></td>
                <td>${running}</td>
            </tr>
            <tr>
                <td><strong>Last heartbeat:</strong></td>
                <td>${lastHeartbeat}</td>
            </tr>
            <tr>
                <td><strong>Age (minutes):</strong></td>
                <td>${ageMinutes}</td>
            </tr>
        </table>`)
    } catch (e) {
        res.send(`
            <h1>No heartbeat file found</h1>
            <p style="color:red">Cron may have stopped. Click to restart:</p>
            <a href="/restart-cron">/restart-cron</a>
        `);
    }
});

/**
 * CRON MANUAL RESTART
 */
app.get('/restart-cron', async (req, res) => {
    Utils.callCronCheckAgain();
    res.json({ success: true, message: 'Cron loop restarted manually.' });
});

/**
 * This entry-point calls the process for any date
 * Example: /run-job-date/2025-12-31
 */
app.get('/run-job-date/:date', async (req, res) => {
    const jobDate = req.params.date; 
    
    // Basic format validation: YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(jobDate)) {
        return res.status(400).json({ 
            success: false, 
            message: 'Invalid date format. Use YYYY-MM-DD' 
        });
    }

    res.json({ 
        success: true, 
        date: jobDate, 
    });

    (async () => {
        try {
            const logs = await doTheJob(jobDate);
            await sendReportEmailTo(
                'walter.rodriguez@vonage.com', 
                `Report for ${jobDate}`,
                `<h1>Job date: ${jobDate}</h1><pre>${logs.join('\n')}</pre>`,
                { isHtml: true }
            );
        } catch (err) {
            console.error(`Job for ${jobDate} failed:`, err.message);
            try {
                await sendReportEmailTo(
                    'walter.rodriguez@vonage.com',
                    `Report FAILED for ${jobDate}`,
                    `<h1>Job failed for ${jobDate}</h1><p>${err.message}</p>`,
                    { isHtml: true }
                );
            } catch (emailErr) {
                console.error('Failed to send failure email:', emailErr.message);
            }
        }
    })();
});

/**
 * JUST TEST THE EMAIL SENDER WITH A DUMMY TEXT
 */
app.get('/test-email', async (req, res) => {
    sendReportEmail(`This is a test. Don't need to take any action`)
    res.send('Email sent');
});

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