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
    const options = { year: 'numeric', month: '2-digit', day: '2-digit' };
    const formattedDate = new Intl.DateTimeFormat('en-US', options).format(currentDate);
    const subject = `Report for ${formattedDate}`;
    await sendReportEmailTo('martin.fort@vonage.com', subject, data)
    await sendReportEmailTo('walter.rodriguez@vonage.com', subject, data)
}

export async function sendReportEmailTo(destination, subject, body, opts = {}) {      
    const mailOptions = {
        from: `"Accor Tracking Report" <${EMAIL_USER}>`,
        to: destination,
        subject,
        ...(opts.isHtml ? { html: body } : { text: body }),
    };
    await transporter.sendMail(mailOptions);
    console.log(`Email sent to ${destination}`);
}
