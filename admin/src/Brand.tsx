import logo from './logo.svg';

// The name is the first thing to remember, so it sits beside the logo on
// every screen; "reborn" carries the accent.
export function Brand({ big = false }: { big?: boolean }) {
  return (
    <div className={big ? 'brand big' : 'brand'}>
      <img src={logo} alt="" />
      <span className="wordmark">bot-<span>reborn</span></span>
    </div>
  );
}
