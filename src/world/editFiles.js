// The edit files a built site carries (public/terrain-edits.bin, world-edits.json, nature-edits.bin):
// listed at build time by vite.config.js (__EDIT_FILES__), so the published page does not ask for
// the ones that do not exist (a 404 each in the console). null in development, where the dev
// server's endpoints answer (204 without a file), and outside Vite (tools importing the modules).
const LIST = typeof __EDIT_FILES__ !== 'undefined' ? __EDIT_FILES__ : null;

export const shipped = ( name ) => LIST === null || LIST.includes( name );
