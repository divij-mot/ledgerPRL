const navigationPaths = {
  overview:
    '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M9 3v18"/>',
  receive: '<path d="M19 5 5 19M5 7v12h12"/>',
  send: '<path d="m5 19 14-14M7 5h12v12"/>',
  activity: '<path d="M4 6h16M4 12h16M4 18h16"/>',
} as const;

export function navigationIcon(page: keyof typeof navigationPaths): string {
  return `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${navigationPaths[page]}</svg>`;
}

export function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}
