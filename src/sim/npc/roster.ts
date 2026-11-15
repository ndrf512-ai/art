/** Штат объекта «Гранит»: 50 человек с биографиями, приметами и распорядком. */
import type { NpcState, RoleId, Shift, UnitId } from '../../core/types';
import { CIGARETTES, FIRST_NAMES, HISTORY_MID, LAST_NAMES, TOWNS } from '../../data/names';
import type { Sim } from '../Sim';

export interface NpcSpec {
  role: RoleId;
  unit: UnitId;
  rank: number;
  shift: Shift;
  position: string;
  work: string;
  armed?: boolean;
}

const S = (role: RoleId, unit: UnitId, rank: number, shift: Shift, position: string, work: string, armed = false): NpcSpec => ({ role, unit, rank, shift, position, work, armed });

export const ROSTER: NpcSpec[] = [
  // офицеры
  S('adjutant', 'staff', 10, 'flex', 'Начальник штаба объекта', 'adjutant_desk'),
  S('battery_cmd', 'staff', 9, 'flex', 'Командир батареи', 'cc_fire'),
  S('security_chief', 'staff', 9, 'flex', 'Начальник охраны объекта', 'duty_desk', true),
  S('ci_officer', 'staff', 10, 'flex', 'Офицер контрразведки (абвер)', 'ci_desk', true),
  S('quartermaster', 'supply', 9, 'flex', 'Интендант', 'qm_desk'),
  S('engineer', 'secret', 11, 'flex', 'Главный инженер установки', 'tech_desk'),
  S('doctor', 'medical', 10, 'flex', 'Начальник медицинского пункта', 'med_desk'),
  // расчёт установки №1
  S('gun_cmd', 'gun1', 6, 'day', 'Командир установки №1', 'hangar_work'),
  S('gunner', 'gun1', 4, 'day', 'Наводчик установки №1', 'hangar_work'),
  S('loader', 'gun1', 3, 'day', 'Заряжающий установки №1', 'hangar_work'),
  S('assistant', 'gun1', 2, 'day', 'Номер расчёта установки №1', 'hangar_work'),
  S('assistant', 'gun1', 1, 'day', 'Номер расчёта установки №1', 'hangar_work'),
  S('bearer', 'gun1', 0, 'day', 'Подносчик установки №1', 'hangar_stand'),
  // орудие №2
  S('gun_cmd', 'gun2', 5, 'day', 'Командир орудия №2', 'gun'),
  S('gunner', 'gun2', 3, 'day', 'Наводчик орудия №2', 'gun'),
  S('loader', 'gun2', 2, 'day', 'Заряжающий орудия №2', 'gun'),
  S('assistant', 'gun2', 1, 'day', 'Номер расчёта орудия №2', 'gun'),
  S('bearer', 'gun2', 0, 'day', 'Подносчик орудия №2', 'gun'),
  // орудие №3
  S('gun_cmd', 'gun3', 4, 'day', 'Командир орудия №3', 'gun'),
  S('gunner', 'gun3', 3, 'day', 'Наводчик орудия №3', 'gun'),
  S('loader', 'gun3', 2, 'day', 'Заряжающий орудия №3', 'gun'),
  S('assistant', 'gun3', 1, 'day', 'Номер расчёта орудия №3', 'gun'),
  S('bearer', 'gun3', 0, 'day', 'Подносчик орудия №3', 'gun'),
  // караульный взвод
  S('guard_sgt', 'guard', 6, 'flex', 'Начальник караула', 'armory_desk', true),
  S('patrol_leader', 'guard', 4, 'day', 'Старший патруля (дневная смена)', 'guard_bench', true),
  S('patrol_leader', 'guard', 4, 'night', 'Старший патруля (ночная смена)', 'guard_bench', true),
  S('guard', 'guard', 3, 'day', 'Караульный', 'guard_bench', true),
  S('guard', 'guard', 2, 'day', 'Караульный', 'guard_bench', true),
  S('guard', 'guard', 1, 'day', 'Караульный', 'guard_bench', true),
  S('guard', 'guard', 0, 'day', 'Караульный', 'guard_bench', true),
  S('guard', 'guard', 3, 'night', 'Караульный', 'guard_bench', true),
  S('guard', 'guard', 2, 'night', 'Караульный', 'guard_bench', true),
  S('guard', 'guard', 1, 'night', 'Караульный', 'guard_bench', true),
  S('guard', 'guard', 1, 'night', 'Караульный', 'guard_bench', true),
  S('guard', 'guard', 0, 'night', 'Караульный', 'guard_bench', true),
  S('guard', 'guard', 0, 'night', 'Караульный', 'guard_bench', true),
  // обеспечение
  S('mech_chief', 'tech', 7, 'day', 'Старший механик', 'ws_bench'),
  S('mechanic', 'tech', 3, 'day', 'Механик', 'ws_bench'),
  S('mechanic', 'tech', 2, 'day', 'Механик', 'rep'),
  S('electrician', 'tech', 3, 'day', 'Электрик-моторист (день)', 'gen_panel'),
  S('electrician', 'tech', 2, 'night', 'Электрик-моторист (ночь)', 'gen_panel'),
  S('radio_op', 'signals', 4, 'day', 'Радист (день)', 'radio_seat'),
  S('radio_op', 'signals', 3, 'night', 'Радист (ночь)', 'radio_seat'),
  S('clerk', 'staff', 2, 'day', 'Писарь, заведующий архивом', 'archive_desk'),
  S('medic', 'medical', 4, 'day', 'Санитар', 'med_cab'),
  S('cook', 'supply', 3, 'day', 'Повар', 'kitchen_stove'),
  S('cook_helper', 'supply', 0, 'day', 'Рабочий по кухне', 'kitchen_prep'),
  S('driver', 'supply', 2, 'day', 'Водитель', 'motor'),
  S('driver', 'supply', 2, 'day', 'Водитель', 'motor'),
  S('technician', 'secret', 4, 'day', 'Техник-чертёжник', 'tech_draft'),
];

export function blankNpc(id: string): NpcState {
  return {
    id,
    first: '',
    last: '',
    rank: 0,
    role: 'guard',
    unit: 'guard',
    position: '',
    age: 25,
    skill: 50,
    serviceYears: 3,
    history: [],
    traits: { smokes: null, boot: 42, leftHanded: false, talkative: 0.5, brave: 0.5, diligent: 0.5 },
    shift: 'day',
    status: 'active',
    health: 100,
    fatigue: 20,
    hunger: 30,
    morale: 60,
    discipline: 70,
    attitude: 50,
    x: 0,
    z: 0,
    yaw: 0,
    zone: 'yard',
    moving: false,
    run: false,
    path: null,
    pathI: 0,
    anchor: null,
    goal: '',
    goalData: null,
    goalScore: 0,
    plan: [],
    stepI: 0,
    stepT: 0,
    stepInit: false,
    brainT: 0,
    cooldowns: {},
    anim: 'idle',
    carry: null,
    armed: false,
    weaponOut: false,
    gesture: null,
    speech: null,
    bedSpot: '',
    workSpot: '',
    spot: null,
    task: '',
    doc: { holder: '', rank: '', unit: '', position: '', clearance: 0, zones: [], serial: '', issued: '', issuedBy: '', age: 0, validUntilDay: 0 },
    memory: [],
    sightings: [],
    log: [],
    lastSalute: -999,
    lastCheck: -9999,
    passes: {},
    flags: {},
    hostile: false,
    seen: [],
  };
}

/** Создаёт человека по штатной записи: имя, возраст, опыт, приметы, послужной список. */
export function makeNpc(sim: Sim, spec: NpcSpec, usedNames: Set<string>): NpcState {
  const rng = sim.rng;
  const n = blankNpc(sim.npcs.nextId('n'));
  let last: string;
  do last = rng.pick(LAST_NAMES);
  while (usedNames.has(last) && usedNames.size < LAST_NAMES.length);
  usedNames.add(last);
  n.last = last;
  n.first = rng.pick(FIRST_NAMES);
  n.rank = spec.rank;
  n.role = spec.role;
  n.unit = spec.unit;
  n.shift = spec.shift;
  n.position = spec.position;
  n.workSpot = spec.work;
  n.armed = !!spec.armed;
  const r = spec.rank;
  n.age = r <= 1 ? rng.int(18, 23) : r <= 3 ? rng.int(20, 29) : r <= 7 ? rng.int(25, 41) : r <= 9 ? rng.int(24, 35) : rng.int(32, 52);
  n.serviceYears = Math.max(1, Math.min(n.age - 18, r <= 3 ? rng.int(1, 4) : rng.int(3, 5 + (r > 9 ? 12 : 3))));
  n.skill = Math.min(96, Math.round(28 + r * 4.2 + rng.range(0, 26)));
  n.morale = Math.round(rng.range(52, 74));
  n.discipline = Math.round(Math.min(95, rng.range(52, 80) + r * 1.5));
  n.attitude = Math.round(rng.range(44, 60));
  n.fatigue = rng.range(8, 25);
  n.hunger = rng.range(45, 60);
  n.traits = {
    smokes: rng.chance(0.62) ? rng.pick(CIGARETTES) : null,
    boot: rng.int(40, 46),
    leftHanded: rng.chance(0.1),
    talkative: rng.next(),
    brave: rng.next(),
    diligent: rng.next(),
  };
  const start = 1944 - n.serviceYears;
  n.history = [`${start} — призван, уроженец ${rng.pick(TOWNS)}`];
  const mids = rng.shuffle([...HISTORY_MID]).slice(0, Math.min(3, Math.max(1, n.serviceYears - 1)));
  mids.sort();
  for (const m of mids) {
    const year = parseInt(m, 10);
    if (year >= start) n.history.push(m);
  }
  n.history.push(`1944 — направлен на объект «Гранит»: ${spec.position.toLowerCase()}`);
  return n;
}

/** Формирует весь гарнизон и расставляет людей по местам на момент начала кампании. */
export function buildRoster(sim: Sim): void {
  const used = new Set<string>();
  const bunks = sim.layout.byTag('bunk');
  const officerBeds = sim.layout.byTag('officer_bed');
  let bi = 0;
  let oi = 0;
  for (const spec of ROSTER) {
    const n = makeNpc(sim, spec, used);
    const bed = spec.rank >= 8 ? officerBeds[oi++ % officerBeds.length] : bunks[bi++ % bunks.length];
    n.bedSpot = bed.id;
    n.x = bed.x;
    n.z = bed.z;
    n.yaw = bed.yaw;
    n.zone = sim.grid.zoneAt(n.x, n.z);
    sim.docs.issue(n);
    sim.npcs.add(n);
  }
  // у нескольких честных людей — канцелярские ошибки в бумагах (ложные следы)
  const pool = sim.rng.shuffle(sim.npcs.list.filter((n) => n.rank < 8)).slice(0, 4);
  for (const n of pool) sim.docs.clericalError(n);
}
