// Minimal Groq-shaped chat-completions server for e2e tests.
// Validates that the extension sent real extracted legal text, records each
// request, and returns a deterministic flag set.
import { createServer } from 'node:http';

const FLAGS = [
  { tier: 'concern', title: 'Sells or shares data with third parties', explanation: 'Personal data may be shared with advertising and analytics partners.', clauseRef: 'Privacy Policy', topic: 'Tracking', quote: 'we may share information with our partners' },
  { tier: 'concern', title: 'Broad license to your uploaded content', explanation: 'You grant a wide, royalty-free license to content you post.', clauseRef: 'Terms of Service', topic: 'Licensing' },
  { tier: 'caution', title: 'Terms can change without notice', explanation: 'Continued use means you accept future changes to these terms.', clauseRef: 'Terms of Service', topic: 'Legal', quote: 'we reserve the right to modify these terms' },
  { tier: 'caution', title: 'Uses tracking cookies by default', explanation: 'Analytics and advertising cookies are on unless you opt out.', clauseRef: 'Privacy Policy', topic: 'Cookies' },
  { tier: 'safe', title: 'You can delete your account anytime', clauseRef: 'Terms of Service', topic: 'Account' },
  { tier: 'safe', title: 'Data is encrypted in transit', clauseRef: 'Privacy Policy', topic: 'Security' },
];

export function startMockGroq(port) {
  const requests = [];
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let parsed = null;
      try { parsed = JSON.parse(body); } catch { /* recorded as null */ }
      const userMsg = parsed?.messages?.find(m => m.role === 'user')?.content || '';
      requests.push({
        auth: req.headers.authorization || '',
        model: parsed?.model,
        userChars: userMsg.length,
        site: (userMsg.match(/^Site: (.+)$/m) || [])[1] || '',
        docHeaders: [...userMsg.matchAll(/^## (.+?) \(/gm)].map(m => m[1]),
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: JSON.stringify({ flags: FLAGS }) } }],
      }));
    });
  });
  return new Promise(resolve => {
    server.listen(port, '127.0.0.1', () => resolve({ server, requests }));
  });
}
