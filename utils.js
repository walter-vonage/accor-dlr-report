import axios from 'axios';
import * as fs from 'fs';
import path from 'path';
const HEARTBEAT_PATH = path.resolve('./cron-heartbeat.txt');

export function callCronCheckAgain() {
    setTimeout(() => {
        const SERVER = process.env.VCR_INSTANCE_PUBLIC_URL || 'http://localhost:3000';

        // Write the current timestamp to a file
        fs.writeFileSync(HEARTBEAT_PATH, new Date().toISOString());

        axios.get(`${SERVER}/cron-runner`).catch((error) => {
            console.error(error);
            callCronCheckAgain(); // retry on failure
        });
    }, 60 * 1000)
}
