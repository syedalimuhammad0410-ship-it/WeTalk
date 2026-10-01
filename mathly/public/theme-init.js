// Apply the saved theme before first paint (kept as a file so the CSP can forbid inline scripts).
try {
  var t = localStorage.getItem('mathly.theme') || 'system';
  if (t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.classList.add('dark');
} catch (e) {}
