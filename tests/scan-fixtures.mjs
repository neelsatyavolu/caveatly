// Local fixture sites for tests/scan-coverage.mjs. One HTTP server answers for
// every *.test host (Chromium maps them to 127.0.0.1 via --host-resolver-rules);
// each host reproduces one way real sites hide or garble their policies.
import { createServer } from 'node:http';

const para = words => `<p>${words}</p>`;
const PRIVACY_PARAS = [
  'This Privacy Policy explains how we collect, use and share personal data when you use the service.',
  'Information we collect includes your name, email address, device identifiers and usage data.',
  'We share personal information with third parties such as analytics and advertising partners.',
  'We use cookies and similar technologies. You can opt out of advertising cookies in settings.',
  'Retention: we keep personal data for as long as your account is active, then delete it.',
  'Your rights: under GDPR and CCPA you may access, correct or delete your personal information.',
];
const TERMS_PARAS = [
  'These Terms of Service form a binding agreement between you and the company.',
  'We grant you a limited license to use the service. You may not reverse engineer it.',
  'Limitation of liability: the service is provided as is, without warranty of any kind.',
  'Any dispute will be resolved by binding arbitration. Governing law is the State of Delaware.',
  'We may suspend or terminate your account at any time. Termination does not end these terms.',
  'Intellectual property in the service remains ours. Indemnification applies to misuse.',
];
const DE_PRIVACY = 'Datenschutzerklärung. Wir verarbeiten personenbezogene Daten nur nach der DSGVO. Cookies setzen wir nur mit Einwilligung. Datenschutz ist uns wichtig. Ihre Rechte: Auskunft, Löschung, Widerspruch.';
const DE_TERMS = 'Allgemeine Geschäftsbedingungen. Mit der Nutzung schließen Sie einen Vertrag. Haftung ist ausgeschlossen, soweit gesetzlich zulässig. Gerichtsstand ist Hamburg. Kündigung jederzeit möglich.';

const repeat = (paras, times) => Array.from({ length: times }, () => paras.map(para).join('')).join('');
export const privacyHtml = (times = 6) => `<!doctype html><title>Privacy Policy</title><main><h1>Privacy Policy</h1>${repeat(PRIVACY_PARAS, times)}</main>`;
export const termsHtml = (times = 6) => `<!doctype html><title>Terms of Service</title><main><h1>Terms of Service</h1>${repeat(TERMS_PARAS, times)}</main>`;
const page = (title, body) => `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;
const filler = n => para('Welcome to our shop. Browse new arrivals, gift ideas and seasonal favourites. '.repeat(n));

// Minimal single-page PDF whose text is a privacy policy (for pdfToText).
export function privacyPdf() {
  const lines = Array.from({ length: 6 }, () => PRIVACY_PARAS).flat();
  const content = `BT /F1 9 Tf 30 980 Td 11 TL ${lines.map(l => `(${l.replace(/[()\\]/g, '')}) Tj T*`).join(' ')} ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 1000] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

const LATE_HOME = page('Late footer', `
  <a href="/news/midterms-2026">Midterms: what happens next</a>
  <a href="/audio/podcasts/terms-of-service-with-a-host">Terms of Service with a host (podcast)</a>
  ${filler(5)}
  <script>
    customElements.define('legal-links', class extends HTMLElement {
      connectedCallback() {
        this.attachShadow({ mode: 'open' }).innerHTML = '<a href="/legal/privacy">Privacy Policy</a>';
      }
    });
    setTimeout(() => {
      const f = document.createElement('footer');
      f.innerHTML = '<a href="/terms">Terms</a> <legal-links></legal-links>';
      document.body.appendChild(f);
    }, 1500);
  </script>`);

// The policy is built by JavaScript: fetching the HTML yields an empty shell.
const JS_SHELL = page('Privacy', `<div id="app"></div><script>
  const paras = ${JSON.stringify(PRIVACY_PARAS)};
  setTimeout(() => {
    document.getElementById('app').innerHTML = '<main><h1>Privacy Policy</h1>' +
      Array.from({ length: 6 }, () => paras.map(p => '<p>' + p + '</p>').join('')).join('') + '</main>';
  }, 300);
</script>`);

const SITES = {
  'late.test': {
    '/': LATE_HOME,
    '/terms': termsHtml(),
    '/legal/privacy': privacyHtml(),
    '/news/midterms-2026': page('Midterms', filler(30)),
    '/audio/podcasts/terms-of-service-with-a-host': page('Podcast', filler(30)),
  },
  'de.test': {
    '/': page('Startseite', `${filler(5)}<footer><a href="/impressum">Impressum</a> <a href="/datenschutz">Datenschutzerklärung</a> <a href="/agb">AGB</a></footer>`),
    '/impressum': page('Impressum', para('Anbieter: Beispiel GmbH, Hamburg. Vertreten durch die Geschäftsführung. '.repeat(30))),
    '/datenschutz': page('Datenschutz', `<main>${para(DE_PRIVACY.repeat(8))}</main>`),
    '/agb': page('AGB', `<main>${para(DE_TERMS.repeat(8))}</main>`),
  },
  'bare.test': {
    '/': page('No footer at all', filler(5)),
    '/privacy': privacyHtml(),
    // Soft 404: 200 OK, but not a policy. Must not be analyzed.
    '/terms': page('Page not found', `<h1>Sorry, we couldn't find that page</h1>${filler(20)}`),
    '/terms-of-use': termsHtml(),
  },
  'js.test': {
    '/': page('JS policy', `${filler(5)}<footer><a href="/privacy">Privacy</a> <a href="/terms">Terms</a></footer>`),
    '/privacy': JS_SHELL,
    '/terms': termsHtml(),
  },
  'hub.test': {
    '/': page('Hub', `${filler(5)}<footer><a href="/privacy">Privacy</a> <a href="/terms">Terms</a></footer>`),
    '/privacy': page('Privacy center', `<main><h1>Privacy center</h1>${para('Learn how we protect you and the choices you have. '.repeat(20))}<a href="/privacy/full-policy">Read the full Privacy Policy</a></main><footer><a href="/privacy">Privacy</a></footer>`),
    '/privacy/full-policy': privacyHtml(),
    '/terms': termsHtml(),
  },
  'login.test': {
    '/': page('Login redirect', `${filler(5)}<footer><a href="/privacy">Privacy</a> <a href="/account/terms">Terms</a></footer>`),
    '/privacy': privacyHtml(),
    '/login': page('Sign in', `<main><h1>Sign in to your account</h1>${para('Enter your email and password to continue. You agree to our terms by signing in. '.repeat(25))}</main>`),
  },
  'big.test': {
    '/': page('Big docs', `${filler(5)}<footer><a href="/privacy">Privacy</a> <a href="/terms">Terms</a></footer>`),
    '/privacy': privacyHtml(1200),
    '/terms': termsHtml(60),
  },
  'pdf.test': {
    '/': page('PDF policy', `${filler(5)}<footer><a href="/privacy.pdf">Privacy Policy</a> <a href="/terms">Terms</a></footer>`),
    '/terms': termsHtml(),
  },
};

const REDIRECTS = { 'login.test': { '/account/terms': '/login' } };

export function startFixtureServer(port) {
  const hits = [];
  const server = createServer((req, res) => {
    const host = (req.headers.host || '').split(':')[0];
    const pathname = new URL(req.url, 'http://x').pathname;
    hits.push(`${host}${pathname}`);
    const redirect = REDIRECTS[host]?.[pathname];
    if (redirect) {
      res.writeHead(302, { location: redirect }).end();
      return;
    }
    if (host === 'pdf.test' && pathname === '/privacy.pdf') {
      res.writeHead(200, { 'content-type': 'application/pdf' }).end(privacyPdf());
      return;
    }
    const body = SITES[host]?.[pathname];
    if (body === undefined) {
      res.writeHead(404, { 'content-type': 'text/html' }).end(page('Not found', 'Not found'));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({ server, hits })));
}
