// What each body is made of, as a line drawing.
//
// The pet and the tarot reader already had a picture: their screen. But the
// screen is one part of a body, and a card that shows only a dog says the body
// is a dog. So each body is drawn from its parts — board, screen, motor
// driver, wheels, microphone, amp — in the same ink as the rest of the page,
// and the screen keeps showing the frames the real one would.
//
// It is a drawing, not a photograph and not a simulation: nothing here moves
// or measures, and the caption says so.
import { useFrameCycle } from './useFrameCycle';

const INK = 'var(--line)';
const PAPER = 'var(--panel)';
const MUTED = 'var(--muted)';

/** Every module is a rounded box; these keep the stroke in one place. */
const box = { fill: PAPER, stroke: INK, strokeWidth: 2, strokeLinejoin: 'round' } as const;

function Board({ x, y, w = 84, h = 44 }: { x: number; y: number; w?: number; h?: number }) {
  return (
    <g data-part="board">
      <rect {...box} x={x} y={y} width={w} height={h} rx={8} />
      <rect x={x + 12} y={y + 12} width={Math.min(30, w / 3)} height={h / 3} rx={3} fill={INK} opacity={0.7} />
      {[0, 1, 2, 3].map((i) => (
        <line key={i} x1={x + w} y1={y + 8 + i * 8} x2={x + w + 6} y2={y + 8 + i * 8} stroke={INK} strokeWidth={2} />
      ))}
    </g>
  );
}

type Kind = 'toy' | 'pet' | 'tarot' | 'voice' | 'dry-run';

export function BodyDiagram({ kind, frames, label }: { kind: Kind | string; frames: string[]; label: string }) {
  const frame = useFrameCycle(frames);
  return (
    <svg viewBox="0 0 280 176" role="img" aria-label={label} className="body-diagram">
      <title>{label}</title>
      {kind === 'toy' || kind === 'dry-run' ? <Car /> : null}
      {kind === 'pet' || kind === 'tarot' ? <Screen frame={frame} /> : null}
      {kind === 'pet' || kind === 'tarot' ? <Board x={20} y={66} h={52} /> : null}
      {kind === 'pet' || kind === 'tarot' ? (
        <line x1={110} y1={92} x2={122} y2={92} stroke={INK} strokeWidth={2} />
      ) : null}
      {kind === 'tarot' ? (
        <g data-part="wand">
          <rect {...box} x={150} y={146} width={94} height={10} rx={5} />
          <circle cx={250} cy={151} r={8} fill={PAPER} stroke={INK} strokeWidth={2} />
          <circle cx={250} cy={151} r={2.5} fill={INK} />
        </g>
      ) : null}
      {kind === 'voice' ? <Voice /> : null}
    </svg>
  );
}

function Car() {
  return (
    <>
      <g data-part="battery">
        <rect {...box} x={44} y={16} width={54} height={20} rx={5} />
        <line x1={52} y1={26} x2={62} y2={26} stroke={INK} strokeWidth={2} />
        <line x1={57} y1={21} x2={57} y2={31} stroke={INK} strokeWidth={2} />
        <line x1={82} y1={26} x2={92} y2={26} stroke={INK} strokeWidth={2} />
      </g>
      <line x1={71} y1={36} x2={71} y2={54} stroke={INK} strokeWidth={2} />
      <Board x={30} y={54} />
      <g data-part="motor">
        <rect {...box} x={150} y={54} width={48} height={30} rx={6} />
        <line x1={114} y1={69} x2={150} y2={69} stroke={INK} strokeWidth={2} />
      </g>
      <g data-part="chassis">
        <path {...box} d="M40 128 h200 a12 12 0 0 0 -12 -12 h-176 a12 12 0 0 0 -12 12 z" />
        <line x1={174} y1={84} x2={174} y2={116} stroke={INK} strokeWidth={2} />
      </g>
      <g data-part="wheels">
        {[70, 210].map((cx) => (
          <g key={cx}>
            <circle cx={cx} cy={146} r={16} fill={PAPER} stroke={INK} strokeWidth={2} />
            <circle cx={cx} cy={146} r={5} fill={MUTED} />
          </g>
        ))}
      </g>
    </>
  );
}

function Screen({ frame }: { frame: string | null }) {
  const id = 'screen-clip';
  return (
    <g data-part="screen">
      <rect {...box} x={122} y={20} width={138} height={98} rx={10} />
      <clipPath id={id}>
        <rect x={132} y={30} width={118} height={72} rx={6} />
      </clipPath>
      <rect x={132} y={30} width={118} height={72} rx={6} fill={MUTED} opacity={0.25} />
      {frame && <image href={frame} x={132} y={30} width={118} height={72} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${id})`} />}
      <line x1={172} y1={118} x2={166} y2={130} stroke={INK} strokeWidth={2} strokeLinecap="round" />
      <line x1={210} y1={118} x2={216} y2={130} stroke={INK} strokeWidth={2} strokeLinecap="round" />
    </g>
  );
}

function Voice() {
  return (
    <>
      <Board x={30} y={62} h={52} />
      <line x1={114} y1={86} x2={144} y2={86} stroke={INK} strokeWidth={2} />
      <g data-part="mic">
        <rect {...box} x={156} y={62} width={18} height={34} rx={9} />
        {[0, 1, 2].map((i) => (
          <line key={i} x1={161} y1={72 + i * 6} x2={169} y2={72 + i * 6} stroke={INK} strokeWidth={1.5} strokeLinecap="round" />
        ))}
        <line x1={165} y1={96} x2={165} y2={116} stroke={INK} strokeWidth={2} />
        <line x1={151} y1={116} x2={179} y2={116} stroke={INK} strokeWidth={2} strokeLinecap="round" />
      </g>
      <g data-part="amp">
        <rect {...box} x={196} y={64} width={52} height={44} rx={7} />
        <path d="M208 78 l16 8 l-16 8 z" fill={INK} />
        <line x1={230} y1={72} x2={240} y2={72} stroke={INK} strokeWidth={2} />
        <line x1={230} y1={82} x2={240} y2={82} stroke={INK} strokeWidth={2} />
      </g>
    </>
  );
}
