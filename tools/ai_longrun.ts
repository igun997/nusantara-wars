import { World, DT } from '../src/sim/world';
import { AI } from '../src/sim/ai';
import { REGION_PRESET } from '../src/data/game';
for (const seed of [11, 4242]) {
  const w = new World({ tribes: ['jawa', 'sunda'], preset: { seed, ...REGION_PRESET['Jawa'] }, humans: [] });
  const ais = [new AI(w, 0, 'sedang'), new AI(w, 1, 'sedang')];
  const log: string[] = [];
  for (let i = 0; i < 1800 / DT && w.winner < 0; i++) {
    ais.forEach((a) => a.update()); w.step();
    for (const e of w.drainEvents()) if (e.t === 'epoch' || e.t === 'nuke_arm' || e.t === 'nuke_hit' || e.t === 'nuke_cancel' || e.t === 'gameover') log.push(`${Math.round(w.time)}s ${e.t}${'owner' in e ? ' p' + (e as any).owner : ''}${'epoch' in e ? ' ep' + (e as any).epoch : ''}${'shot' in e ? ' p' + (e as any).shot.owner : ''}`);
  }
  console.log('seed', seed, 'end', Math.round(w.time), 'winner', w.winner, '\n' + log.join('\n'));
}
