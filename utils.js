import axios from 'axios';

export function callCronCheckAgain() {
    setTimeout(() => {
        const SERVER = process.env.VCR_INSTANCE_PUBLIC_URL || 'http://localhost:3000';
        axios.get(`${SERVER}/cron-runner`).catch((error) => {
            console.error(error);
            callCronCheckAgain();
        });
    }, 60 * 1000)
}
