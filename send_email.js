// email_report.js
import nodemailer from "nodemailer";
import {config} from './config.js'

const EMAIL_USER = config.username;
const EMAIL_PASS = config.password;

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
});

export async function sendReportEmail(data) {  

    const currentDate = new Date();

    const options = {
        weekday: 'long', // Full weekday name (e.g., "Tuesday")
        month: 'long',   // Full month name (e.g., "October")
        day: 'numeric'   // Day of the month (e.g., "7")
    };
    
    // Use the Intl.DateTimeFormat object for robust, locale-aware formatting.
    const formattedDate = new Intl.DateTimeFormat('en-US', options).format(currentDate);
    
    const mailOptions = {
        from: `"Accor Tracking Report" <${EMAIL_USER}>`,
        to: 'martin.fort@vonage.com',
        cc: 'walter.rodriguez@vonage.com',
        subject: `Report for ${formattedDate}`,
        text: data,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Email sent`);
}
