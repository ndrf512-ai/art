/**
 * CounterIntelligenceSystem — расследование. Игра нигде не сообщает, кто шпион:
 * копятся косвенные признаки (наблюдения часовых, расхождения в документах,
 * улики на местах диверсий, противоречия в показаниях), а решение принимает командир.
 */
import type { CaseFile, Evidence, NpcState, SceneClue, Sighting } from '../core/types';
import { ZONES } from '../world/layout';
import { FLAW_TEXT, fullName } from './DocumentSystem';
import type { GoalOption } from './NPCSystem';
import type { Sim } from './Sim';
import { WorldTimeSystem } from './WorldTimeSystem';

const QUIET_ZONES = new Set(['barracks', 'officers', 'quarters', 'infirmary', 'tunnel', 'mess', 'portal']);
const SECURITY_ROLES = new Set(['guard', 'patrol_leader', 'guard_sgt', 'security_chief', 'ci_officer', 'adjutant']);

export class CounterIntelligenceSystem {
  state = {
    evidence: [] as Evidence[],
    cases: {} as Record<string, CaseFile>,
    clues: [] as SceneClue[],
    seq: 0,
    detained: {} as Record<string, { since: number; by: string; where: string; issues: string[]; reviewAt: number; reviewed?: boolean }>,
    summoned: {} as Record<string, boolean>,
    convicted: [] as string[],
    wrongArrests: 0,
  };
  private pairSeen = new Map<string, number>();

  constructor(private sim: Sim) {
    sim.npcs.hooks.push((n, o) => this.onSeen(n, o));
  }

  reset(): void {
    this.state = { evidence: [], cases: {}, clues: [], seq: 0, detained: {}, summoned: {}, convicted: [], wrongArrests: 0 };
    this.pairSeen.clear();
  }

  // ------------------------------------------------------------------ улики и дела

  openCase(id: string): CaseFile {
    let c = this.state.cases[id];
    if (!c) {
      c = { suspect: id, opened: this.sim.now, surveillance: false, restricted: false, status: 'open', notes: [], handedAt: 0 };
      this.state.cases[id] = c;
      this.sim.bus.emit('ci:case', { suspect: id });
    }
    return c;
  }

  case(id: string): CaseFile | undefined {
    return this.state.cases[id];
  }

  cases(): CaseFile[] {
    return Object.values(this.state.cases).sort((a, b) => b.opened - a.opened);
  }

  addEvidence(suspect: string, kind: Evidence['kind'], text: string, source: string, weight: number): void {
    const now = this.sim.now;
    // одинаковые наблюдения подряд не дублируются
    if (this.state.evidence.some((e) => e.suspect === suspect && e.kind === kind && e.text === text && now - e.t < 240)) return;
    const ev: Evidence = { id: 'v' + ++this.state.seq, t: now, suspect, kind, text, source, weight };
    this.state.evidence.push(ev);
    if (this.state.evidence.length > 160) this.state.evidence.shift();
    this.openCase(suspect);
    this.sim.bus.emit('ci:evidence', { evidence: ev });
  }

  evidenceFor(id: string): Evidence[] {
    return this.state.evidence.filter((e) => e.suspect === id);
  }

  /** Насколько найденные на местах улики сходятся с приметами человека. */
  clueMatch(n: NpcState): { match: SceneClue[]; mismatch: SceneClue[] } {
    const match: SceneClue[] = [];
    const mismatch: SceneClue[] = [];
    for (const c of this.state.clues) {
      if (!c.found) continue;
      if (c.trait === 'smokes') (n.traits.smokes === c.value ? match : mismatch).push(c);
      else if (c.trait === 'boot') (n.traits.boot === c.value ? match : mismatch).push(c);
      else if (c.trait === 'leftHanded') (n.traits.leftHanded === c.value ? match : mismatch).push(c);
    }
    return { match, mismatch };
  }

  /** Суммарный вес улик (внутренняя оценка; игроку числом не показывается). */
  score(id: string): number {
    const n = this.sim.npcs.byId(id);
    let s = 0;
    const byKind: Record<string, number> = {};
    for (const e of this.evidenceFor(id)) {
      // однотипные улики дают убывающий вклад
      const k = (byKind[e.kind] = (byKind[e.kind] ?? 0) + 1);
      s += e.weight / k;
    }
    if (n) {
      const cm = this.clueMatch(n);
      s += Math.min(3, cm.match.length) * 1.5 - cm.mismatch.length * 1.5;
    }
    return Math.max(0, s);
  }

  /** Мнение офицера контрразведки о деле — словами. */
  opinion(id: string): string {
    const s = this.score(id);
    if (s < 1.5) return 'Оснований подозревать его пока нет.';
    if (s < 3.5) return 'Подозрения слабые. Я бы понаблюдал.';
    if (s < 6) return 'Материала для разработки хватает, для ареста — нет. Нужны прямые улики.';
    return 'Улик достаточно. Можно брать.';
  }

  // ------------------------------------------------------------------ наблюдения личного состава

  private onSeen(n: NpcState, o: NpcState): void {
    if (o.hostile || o.unit === 'enemy' || n.unit === 'enemy' || n.hostile) return;
    const sim = this.sim;
    let note: Sighting['note'] | null = null;
    if (o.flags.tampering) note = 'tamper';
    else if (o.flags.transmitting) note = 'transmit';
    else if (!sim.access.canEnter(o, o.zone) && sim.zones.level(o.zone) >= 2) note = 'restricted';
    else if (sim.time.isNight() && sim.schedule.block(o) === 'sleep' && !QUIET_ZONES.has(o.zone) && !o.goal.startsWith('crew') && !o.goal.startsWith('repair') && sim.alert.level < 2) note = 'night';
    if (!note) return;
    const key = n.id + '|' + o.id + '|' + note;
    const last = this.pairSeen.get(key);
    if (last !== undefined && sim.now - last < 90) return;
    this.pairSeen.set(key, sim.now);
    n.sightings.push({ t: sim.now, who: o.id, zone: o.zone, note });
    if (n.sightings.length > 14) n.sightings.shift();
    // охрана и офицеры докладывают сразу, остальные — только если их спросят
    if (SECURITY_ROLES.has(n.role) && sim.schedule.onDuty(n)) {
      this.reportSighting(n, n.sightings[n.sightings.length - 1]);
      if (note === 'tamper' || note === 'transmit') {
        sim.alert.raise(1, 'Часовой заметил подозрительные действия.');
        this.detain(o, n, [note === 'tamper' ? 'застигнут за вознёй у оборудования' : 'застигнут с радиопередатчиком'], ZONES[o.zone].name, true);
      }
    }
  }

  private sightingText(s: Sighting): string {
    const zone = ZONES[s.zone]?.name ?? s.zone;
    const time = WorldTimeSystem.clock(s.t);
    switch (s.note) {
      case 'tamper':
        return `В ${time} возился у оборудования в зоне «${zone}»`;
      case 'transmit':
        return `В ${time} замечен с радиопередатчиком — «${zone}»`;
      case 'restricted':
        return `В ${time} находился в зоне «${zone}» без допуска`;
      case 'night':
        return `В ${time}, после отбоя, замечен в зоне «${zone}»`;
      default:
        return `В ${time} замечен в зоне «${zone}»`;
    }
  }

  private reportSighting(witness: NpcState, s: Sighting): void {
    const w = s.note === 'tamper' ? 6 : s.note === 'transmit' ? 6 : s.note === 'restricted' ? 1.3 : 0.8;
    const kind = s.note === 'tamper' ? 'redhanded' : s.note === 'transmit' ? 'transmit' : 'offzone';
    this.addEvidence(s.who, kind, this.sightingText(s), fullName(witness), w);
    (s as any).reported = true;
    const o = this.sim.npcs.byId(s.who);
    if (o) this.sim.guard.log(`${fullName(witness)}: ${fullName(o)} — ${this.sightingText(s).toLowerCase()}.`);
  }

  /**
   * Опрос свидетеля командиром: человек рассказывает, что видел необычного.
   * Говорит, только если относится к командиру не враждебно.
   */
  testimony(witness: NpcState): string[] {
    const sim = this.sim;
    if (witness.attitude < 32) return ['Ничего не видел, ' + sim.address() + '.'];
    const out: string[] = [];
    for (const s of witness.sightings) {
      const o = sim.npcs.byId(s.who);
      if (!o) continue;
      out.push(`${fullName(o)}: ${this.sightingText(s).toLowerCase()}.`);
      if (!(s as any).reported) this.reportSighting(witness, s);
    }
    if (!out.length) out.push('Ничего необычного не замечал, ' + sim.address() + '.');
    return out;
  }

  // ------------------------------------------------------------------ улики на месте

  addClue(place: string, text: string, trait: SceneClue['trait'], value: SceneClue['value']): SceneClue {
    const c: SceneClue = { id: 'c' + ++this.state.seq, t: this.sim.now, place, text, trait, value, found: false };
    this.state.clues.push(c);
    return c;
  }

  /** Осмотр места командиром: возвращает новые находки. */
  searchPlace(place: string): SceneClue[] {
    const found = this.state.clues.filter((c) => c.place === place && !c.found);
    for (const c of found) c.found = true;
    return found;
  }

  foundClues(): SceneClue[] {
    return this.state.clues.filter((c) => c.found);
  }

  // ------------------------------------------------------------------ задержание

  detain(npc: NpcState, by: NpcState, issues: string[], where: string, redHanded = false): void {
    const sim = this.sim;
    if (this.state.detained[npc.id] || npc.status !== 'active') return;
    this.state.detained[npc.id] = { since: sim.now, by: by.id, where, issues, reviewAt: sim.now + sim.rng.range(90, 150) };
    npc.flags.escorted = true;
    sim.npcs.clearGoal(npc);
    if (!redHanded) this.addEvidence(npc.id, 'doc', `Расхождения в документах: ${issues.join('; ')}`, fullName(by), Math.min(2.4, 0.9 * issues.length));
    sim.guard.log(`${where}: задержан ${fullName(npc)} — ${issues.join('; ')}.`);
    sim.npcs.speak(by, 'Вы задержаны до выяснения. Следуйте в караульное помещение.', true);
    sim.radio.send(`${where} (${fullName(by)})`, `Задержан ${fullName(npc)}`, `Задержан ${fullName(npc)}, ${npc.position.toLowerCase()}. Причина: ${issues.join('; ')}. Доставлен в отдел контрразведки, жду распоряжений.`, 'urgent', 'detain', { id: npc.id }, false);
  }

  isDetained(id: string): boolean {
    return !!this.state.detained[id];
  }

  release(id: string, note: string): void {
    const n = this.sim.npcs.byId(id);
    delete this.state.detained[id];
    delete this.state.summoned[id];
    if (!n) return;
    delete n.flags.escorted;
    if (n.status === 'arrested') this.sim.npcs.setStatus(n, 'active');
    else this.sim.npcs.clearGoal(n);
    const c = this.state.cases[id];
    if (c) {
      c.notes.push(`${this.sim.time.stamp()}: ${note}`);
      if (c.status === 'handed' || c.status === 'interrogation') c.status = 'open';
    }
  }

  /** Вызвать на допрос в отдел контрразведки. */
  summon(id: string, on: boolean): void {
    if (on) this.state.summoned[id] = true;
    else delete this.state.summoned[id];
    const n = this.sim.npcs.byId(id);
    if (n) this.sim.npcs.clearGoal(n);
    const c = this.openCase(id);
    c.status = on ? 'interrogation' : 'open';
  }

  surveillance(id: string, on: boolean): string | null {
    const active = this.cases().filter((c) => c.surveillance).length;
    if (on && active >= 2) return 'У контрразведки нет людей, чтобы вести больше двух человек одновременно.';
    const c = this.openCase(id);
    c.surveillance = on;
    c.notes.push(`${this.sim.time.stamp()}: наружное наблюдение ${on ? 'установлено' : 'снято'}.`);
    return null;
  }

  restrict(id: string, on: boolean): void {
    const c = this.openCase(id);
    c.restricted = on;
    this.sim.access.restrict(id, on);
    c.notes.push(`${this.sim.time.stamp()}: допуск ${on ? 'ограничен общими зонами' : 'восстановлен'}.`);
  }

  /** Передать дело контрразведке: арест и следствие. */
  handOver(id: string): void {
    const sim = this.sim;
    const n = sim.npcs.byId(id);
    if (!n) return;
    const c = this.openCase(id);
    c.status = 'handed';
    c.handedAt = sim.now + sim.rng.range(120, 220);
    delete this.state.detained[id];
    delete this.state.summoned[id];
    n.flags.escorted = true;
    sim.npcs.setStatus(n, 'arrested');
    c.notes.push(`${sim.time.stamp()}: арестован, дело передано контрразведке.`);
    for (const o of sim.npcs.list) {
      if (o.unit === n.unit && o !== n && o.status === 'active') sim.npcs.remember(o, 'incident', `Арестован ${fullName(n)}`, 1.5);
    }
  }

  /** Противоречит ли заявленное место известным наблюдениям. */
  contradicts(id: string, t: number, zone: string): Evidence | null {
    for (const e of this.evidenceFor(id)) {
      if (Math.abs(e.t - t) < 40 && (e.kind === 'offzone' || e.kind === 'redhanded' || e.kind === 'testimony') && !e.text.includes(ZONES[zone as keyof typeof ZONES]?.name ?? '§')) return e;
    }
    return null;
  }

  // ------------------------------------------------------------------ цели NPC

  option(n: NpcState): GoalOption | null {
    const sim = this.sim;
    if (n.status === 'arrested') {
      const sp = sim.layout.byTag('cell')[Math.abs(n.id.length * 7 + n.id.charCodeAt(n.id.length - 1)) % 3];
      return { key: 'detained:cell', score: 99, task: 'Под арестом', plan: () => [{ k: 'go', x: sp.x, z: sp.z, tol: 0.6 }, { k: 'do', anim: 'idle', dur: 30, yaw: sp.yaw }] };
    }
    if (n.status !== 'active') return null;
    if (this.state.detained[n.id]) {
      const sp = sim.layout.byTag('ci_stand')[1];
      return { key: 'detained:wait', score: 95, task: 'Задержан до выяснения', plan: () => [{ k: 'go', x: sp.x, z: sp.z, tol: 0.7 }, { k: 'do', anim: 'idle', dur: 20, yaw: sp.yaw }] };
    }
    if (this.state.summoned[n.id]) {
      const sp = sim.layout.byTag('interrogation')[0];
      return { key: 'detained:interrogation', score: 92, task: 'Вызван на допрос', plan: () => [{ k: 'go', x: sp.x, z: sp.z, spot: sp.id }, { k: 'do', anim: 'sit', dur: 20, spot: sp.id }] };
    }
    return null;
  }

  update(): void {
    const sim = this.sim;
    const now = sim.now;
    // разбор задержаний офицером контрразведки, если командир не вмешался
    for (const [id, d] of Object.entries(this.state.detained)) {
      if (now < d.reviewAt) continue;
      const n = sim.npcs.byId(id);
      const ci = sim.npcs.first('ci_officer');
      if (!n) {
        delete this.state.detained[id];
        continue;
      }
      if (n.unit === 'external') continue;
      const spy = sim.spy.isSpy(id);
      const from = ci ? `Контрразведка (${fullName(ci)})` : 'Контрразведка';
      if (!spy) {
        // канцелярская ошибка: документы приводят в порядок
        const reg = sim.docs.registry(id);
        if (reg) {
          reg.age = n.doc.age;
          reg.holder = n.doc.holder;
        }
        n.doc.validUntilDay = 0;
        this.release(id, 'проверен, канцелярская ошибка в документах исправлена, освобождён.');
        n.attitude = Math.max(0, n.attitude - 3);
        sim.radio.send(from, `Освобождён ${fullName(n)}`, `${fullName(n)} проверен. Расхождения в бумагах — канцелярская ошибка, исправлено. Освобождён.`, 'routine', 'ci', { id }, false);
      } else if (d.reviewed) {
        this.release(id, 'срок задержания истёк, решения командира не последовало — освобождён.');
        sim.radio.send(from, `Освобождён ${fullName(n)}`, `Держать ${fullName(n)} дольше без вашего решения не вправе. Освобождён. Материалы остаются в деле.`, 'routine', 'ci', { id }, false);
      } else if (ci && sim.rng.chance(0.3 + ci.skill / 300)) {
        d.reviewed = true;
        sim.radio.send(from, `${fullName(n)}: документы поддельные`, `Документы ${fullName(n)} — подделка: ${sim.docs.discrepancies(n).map((k) => FLAW_TEXT[k]).join('; ')}. Рекомендую арест и передачу дела мне.`, 'urgent', 'ci', { id }, false);
        this.addEvidence(id, 'doc', 'Экспертиза контрразведки: документы поддельные', from, 3.5);
        d.reviewAt = now + 480;
      } else {
        this.release(id, 'проверен контрразведкой, оснований для ареста не найдено, освобождён.');
        sim.radio.send(from, `Освобождён ${fullName(n)}`, `${fullName(n)} опрошен. Объясняет расхождения ошибкой писаря. Прямых оснований держать его нет — освобождён. Рекомендую присмотреться.`, 'routine', 'ci', { id }, false);
      }
    }
    // итог следствия по переданным делам
    for (const c of this.cases()) {
      if (c.status !== 'handed' || now < c.handedAt) continue;
      this.verdict(c);
    }
  }

  private verdict(c: CaseFile): void {
    const sim = this.sim;
    const n = sim.npcs.byId(c.suspect);
    if (!n) {
      c.status = 'cleared';
      return;
    }
    const s = this.score(c.suspect);
    const guilty = sim.spy.isSpy(c.suspect);
    const ci = sim.npcs.first('ci_officer');
    const from = ci ? `Контрразведка (${fullName(ci)})` : 'Контрразведка';
    if (guilty && (s >= 6 || sim.rng.chance(0.18 + s * 0.09))) {
      c.status = 'convicted';
      this.state.convicted.push(n.id);
      c.notes.push(`${sim.time.stamp()}: сознался. Агент противника.`);
      const defused = sim.sabotage.defuseAll(n.id);
      sim.spy.caught(n.id);
      sim.radio.send(from, `${fullName(n)} — агент противника`, `${fullName(n)} дал показания: заброшен с поддельными документами, вёл наблюдение за объектом и готовил диверсии.${defused ? ` Указал заложенное: обезврежено ${defused}.` : ''} Отправляем под конвоем в штаб.`, 'urgent', 'ci_verdict', { id: n.id, guilty: true }, false);
      sim.relations.event('spy_caught');
      sim.missions.flag('spy_caught', true);
    } else if (guilty) {
      c.status = 'open';
      sim.spy.scare(n.id);
      this.release(n.id, 'следствие: улик недостаточно, освобождён.');
      sim.radio.send(from, `${fullName(n)}: улик недостаточно`, `Допросы ${fullName(n)} ничего не дали: держится уверенно, прямых улик нет. Вынужден освободить. Если подозрения остаются — нужны доказательства.`, 'urgent', 'ci_verdict', { id: n.id, guilty: false }, false);
    } else {
      c.status = 'cleared';
      this.state.wrongArrests++;
      this.release(n.id, 'следствие: невиновен, освобождён.');
      n.attitude = Math.max(0, n.attitude - (s >= 4 ? 7 : 14));
      n.morale = Math.max(0, n.morale - 8);
      sim.relations.unitMood(n.unit, s >= 4 ? -2 : -5, `Арест невиновного: ${fullName(n)}`);
      sim.radio.send(from, `${fullName(n)} невиновен`, `Проверка закончена: ${fullName(n)} к агентуре противника отношения не имеет. Освобождён. В подразделении арест восприняли тяжело.`, 'urgent', 'ci_verdict', { id: n.id, guilty: false }, false);
    }
  }

  save(): unknown {
    return this.state;
  }

  load(d: any): void {
    this.state = d;
    this.pairSeen.clear();
  }
}
