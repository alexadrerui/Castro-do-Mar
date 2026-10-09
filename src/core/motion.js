// Reduced motion (the system's "reduzir movimento", prefers-reduced-motion; the idea of Ascent,
// github.com/hapybeing/Ascent): the camera jumps to a view instead of flying there, the lightning
// does not shake it, and the page's spinning and bouncing animations stop (style.css). The world
// itself (wind, water, birds) keeps moving: it is what the page is for.
// ?motion=reduce or ?motion=full override the system's setting (tests, a visitor's choice).

const forced = new URLSearchParams( location.search ).get( 'motion' );
const query = typeof matchMedia === 'function' ? matchMedia( '(prefers-reduced-motion: reduce)' ) : null;

export const motion = {
	reduced: forced ? forced === 'reduce' : !! query?.matches
};

if ( ! forced ) query?.addEventListener?.( 'change', ( e ) => { motion.reduced = e.matches; apply(); } );

function apply() {
	document.documentElement.classList.toggle( 'reduce-motion', motion.reduced );
}
apply();
