// Shared constants. Areas come from cases/index.json; everything else lives here.
// Default levels when cases/index.json doesn't list its own under suite.levels.
// The first level is the headline one: its pass count gets its own summary tile.
export const LEVELS = ['MUST', 'SHOULD', 'Checklist', 'Dev fix'];
export const STATUSES = ['untested', 'pass', 'fail', 'blocked'];
export const LABEL = { untested: 'Untested', pass: 'Pass', fail: 'Fail', blocked: 'Blocked' };

export const CASES_INDEX = 'cases/index.json';
export const SHEET_API = '/api/sheet';
export const CASES_API = '/api/cases';
export const UPLOAD_API = '/api/upload';
export const IMAGE_API = '/api/image';
export const AUTOSAVE_DELAY_MS = 1500; // results autosave this long after the last click

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const MAX_IMAGE_EDGE = 2400; // px; larger screenshots are scaled down before upload

// Results with this status can't be submitted without a conversation ID.
export const CONVO_REQUIRED_FOR = ['fail'];
