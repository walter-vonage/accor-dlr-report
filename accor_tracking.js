import fs from 'fs';

// Example usage
const csvData = parseCSV('report_MESSAGES_cb28378f_20250725.csv');
console.log(csvData);

// removing first entry
processArrayWithSleep(csvData.slice(1));

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function processArrayWithSleep(arr) {
    const chunkSize = 500;  // Process 500 items at a time
    let items = [];
    let count = 1;


    for (let i = 0; i < arr.length; i += chunkSize) {
        const chunk = arr.slice(i, i + chunkSize);

        // Process the chunk
        for (const row of chunk) {
            console.log(`Processing: ${row}`);
            console.log("SFMC data", {
                to: row[5],
                from: row[4],
                channel: row[8],
                message_uuid: row[1],
                dateString: row[14],
                type: row[11],
                status: row[16],
            });

            if (row[12] != "service") {
                items.push(
                    {
                        to: row[5],
                        from: row[4],
                        channel: row[8],
                        message_uuid: row[1],
                        dateString: row[14],
                        type: row[11],
                        status: row[16],
                    }
                );

            }
            count++;
            if (count == chunkSize + 1) {
                await sendRequest(items);
                console.log(items);
                items = [];
                count = 1;
            }

        }


        // If there are more items to process, sleep for 10 seconds
        if (i + chunkSize < arr.length) {
            console.log(`----------------------`);
            console.log(`Processed ${i + chunkSize} items, now sleeping for 10 seconds...`);
            console.log(`----------------------`);
            await sleep(2000); // Sleep for 10 seconds
        }
    }

    console.log('Finished processing all items!');
}


// Example usage







async function sendRequest(items) {

    const myHeaders = new Headers();
    myHeaders.append("Content-Type", "application/json");

    const raw = JSON.stringify(items);


    const requestOptions = {
        method: "POST",
        headers: myHeaders,
        body: raw,
        redirect: "follow"
    };

    await fetch("https://neru-cb28378f-marketing-cloud-apis-dev.euw1.runtime.vonage.cloud/tracking/bulk", requestOptions)
        //https://neru-cb28378f-debug-debug.euw1.runtime.vonage.cloud
        //await fetch("https://neru-cb28378f-marketing-cloud-apis-dev.euw1.runtime.vonage.cloud/tracking/bulk", requestOptions)
        .then((response) => response.text())
        .then((result) => console.log(result))
        .catch((error) => console.error(error));


}




function parseCSV(filePath) {
    // Read the file synchronously
    const data = fs.readFileSync(filePath, 'utf-8');

    // Split the file content into rows based on newline
    const rows = data.split('\n');

    // Process each row into columns, removing surrounding quotes
    const parsedData = rows.map(row =>
        row.split(',').map(value => {
            // Remove surrounding quotes (if present)
            return value.replace(/^"([^"]*)"$/, '$1').replace(/^'(.*)'$/, '$1'); // Handles both double and single quotes
        })
    );

    return parsedData;
}

