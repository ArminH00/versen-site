const { sendJson } = require('../lib/shopify');

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });

    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Metoden stöds inte' });
    return;
  }

  let body;

  try {
    body = await readBody(req);
  } catch (error) {
    sendJson(res, 400, { error: 'Ogiltig JSON' });
    return;
  }

  const memberCode = process.env.VERSEN_MEMBER_ACCESS_CODE;

  if (!memberCode) {
    sendJson(res, 503, { error: 'Medlemsinloggning är inte konfigurerad ännu' });
    return;
  }

  if (body.memberCode !== memberCode) {
    sendJson(res, 401, { error: 'Fel medlemskod' });
    return;
  }

  sendJson(res, 200, {
    member: true,
    status: 'Aktiv medlem',
  });
};
