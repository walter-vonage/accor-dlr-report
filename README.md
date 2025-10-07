## index.js

This report runs at 3 AM (VCR server time zone)

1) Asks for a report via Reports API using the credentials from the VCR account where this program is running.
2) Once the report is ready (it tries 30 times with a waiting period of 5 seconds), downlodas the ZIP file to folder /data
3) Unzips the file and checks for a file ending "csv"
4) Runs the process defined by Marc
5) Sends the POST request as specified by Marc
6) Renames the "csv" to "csv.done"
7) Deletes the ZIP file

NOTES
According to this page: https://developer.vonage.com/en/vonage-cloud-runtime/providers/scheduler?source=vonage-cloud-runtime
Cron also works in VCR. This is what we're using here.

TEST
1) Local on your cmputer:
```
node index.js
```
And wait until 3 AM

3) Run now
```
node index.js --now
```
And you should see log in your console.

## Check cron status
Call this entrypoint from any browser: 
```
https://neru-cb28378f-accor-tracking-dev.euw1.runtime.vonage.cloud/cron-status
```
If the cron is not running or if you see a message like:
```
No heartbeat file found
```
Then restart the cron by clicking here:
```
https://neru-cb28378f-accor-tracking-dev.euw1.runtime.vonage.cloud/restart-cron
```

## Run the report for any date
If any date is missing from the report, you can run it manually, like this (from any browser)
```
https://neru-cb28378f-accor-tracking-dev.euw1.runtime.vonage.cloud/run-job-date/2025-10-07
```
Where ```2025-10-07``` is the date you want to run (it will use the date before, actually)
