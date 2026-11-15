/**
 * Общие типы данных симуляции.
 * Всё состояние симуляции — простые JSON-совместимые объекты, сущности ссылаются
 * друг на друга только по идентификаторам: это делает возможным полное сохранение.
 */
import type { Vec2 } from './math';

export type { Vec2 };

// ---------------------------------------------------------------- зоны и допуски

export type ZoneId =
  | 'solid'
  | 'tunnel'
  | 'portal'
  | 'tunnel_ammo'
  | 'tunnel_staff'
  | 'secret_tunnel'
  | 'generator'
  | 'workshop'
  | 'repair'
  | 'armory'
  | 'ammo1'
  | 'ammo2'
  | 'barracks'
  | 'mess'
  | 'food'
  | 'infirmary'
  | 'command'
  | 'quarters'
  | 'radio'
  | 'officers'
  | 'archive'
  | 'ci'
  | 'cell'
  | 'tech'
  | 'hangar'
  | 'lab'
  | 'yard'
  | 'parade'
  | 'motor'
  | 'fuel'
  | 'firing_main'
  | 'firing_reserve'
  | 'rail'
  | 'kpp'
  | 'kpp_house'
  | 'observation'
  | 'perimeter'
  | 'outside';

/** Группа допуска: «разрешённые зоны» в документах перечисляются группами. */
export type AccessGroup = 'general' | 'tech' | 'supply' | 'arty' | 'guard' | 'staff' | 'ci' | 'secret' | 'medical';

/** 0 — посторонний, 1 — общий, 2 — служебный, 3 — штабной, 4 — особой важности. */
export type Clearance = 0 | 1 | 2 | 3 | 4;

export interface ZoneDef {
  id: ZoneId;
  name: string;
  level: Clearance;
  group: AccessGroup;
  indoor: boolean;
  ceil: number;
  /** Трафаретная надпись на стене (по-немецки, как на реальных объектах). */
  sign?: string;
}

export type AlertLevel = 0 | 1 | 2 | 3;
export const ALERT_NAMES = ['ЗЕЛЁНЫЙ', 'ЖЁЛТЫЙ', 'ОРАНЖЕВЫЙ', 'КРАСНЫЙ'] as const;

// ---------------------------------------------------------------- планировка

export type SpotKind = 'bed' | 'seat' | 'desk' | 'work' | 'post' | 'rest' | 'stand' | 'stack' | 'cell' | 'treat' | 'form';

export interface Spot {
  id: string;
  kind: SpotKind;
  tag: string;
  zone: ZoneId;
  /** Клетка, куда NPC приходит ногами. */
  x: number;
  z: number;
  yaw: number;
  /** Якорь позы (кровать, стул, площадка вышки): куда «садится/ложится» фигура. */
  ax?: number;
  az?: number;
  ay?: number;
}

export interface PropDef {
  type: string;
  x: number;
  z: number;
  yaw: number;
  w: number;
  d: number;
  h: number;
  p?: Record<string, number | string | boolean>;
}

export type LampKind = 'ceiling' | 'wall' | 'pole' | 'red';

export interface LampDef {
  x: number;
  y: number;
  z: number;
  kind: LampKind;
  outdoor: boolean;
  power: number;
}

export type InteractKind =
  | 'fire_table'
  | 'map_table'
  | 'phone'
  | 'radio_log'
  | 'equipment'
  | 'archive'
  | 'bed'
  | 'patrol_board'
  | 'ammo'
  | 'fuel'
  | 'gun'
  | 'safe'
  | 'siren';

export interface Interactable {
  id: string;
  kind: InteractKind;
  label: string;
  x: number;
  z: number;
  y: number;
  /** Идентификатор связанного объекта (оборудование, орудие…). */
  ref?: string;
}

export interface GateDef {
  id: string;
  name: string;
  /** Прямоугольник-триггер (в клетках, включительно). */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Зона, вход в которую контролируется. */
  protects: ZoneId;
  postSpot: string;
  /** С какой стороны «внутри»: проверяются только идущие внутрь. */
  inside: Vec2;
}

export type GunId = 'gun1' | 'gun2' | 'gun3';

export interface GunSiteDef {
  id: GunId;
  name: string;
  kind: 'rail' | 'howitzer';
  /** Основная огневая позиция. */
  main: Vec2;
  /** Запасная позиция (для гаубиц) или укрытие в ангаре (для установки). */
  alt: Vec2;
  /** Смещения боевых постов относительно орудия: [командир, наводчик, заряжающий, помощник, помощник2, подносчик]. */
  stations: Vec2[];
  niche: Vec2;
  nicheAlt: Vec2;
}

// ---------------------------------------------------------------- личный состав

export type UnitId = 'staff' | 'gun1' | 'gun2' | 'gun3' | 'guard' | 'tech' | 'signals' | 'supply' | 'medical' | 'secret' | 'external' | 'enemy';

export type RoleId =
  | 'adjutant'
  | 'battery_cmd'
  | 'security_chief'
  | 'ci_officer'
  | 'quartermaster'
  | 'engineer'
  | 'doctor'
  | 'gun_cmd'
  | 'gunner'
  | 'loader'
  | 'assistant'
  | 'bearer'
  | 'guard_sgt'
  | 'patrol_leader'
  | 'guard'
  | 'mech_chief'
  | 'mechanic'
  | 'electrician'
  | 'radio_op'
  | 'clerk'
  | 'medic'
  | 'cook'
  | 'cook_helper'
  | 'driver'
  | 'technician'
  | 'inspector'
  | 'courier'
  | 'new_officer'
  | 'visitor'
  | 'intruder';

export type Shift = 'day' | 'night' | 'flex';

export type NpcStatus = 'active' | 'wounded' | 'dead' | 'arrested' | 'leave' | 'away';

export type AnimId =
  | 'idle'
  | 'attention'
  | 'salute'
  | 'guard'
  | 'aim'
  | 'kneel_aim'
  | 'work'
  | 'repair'
  | 'repair_low'
  | 'crank'
  | 'ram'
  | 'sit'
  | 'sit_write'
  | 'sit_eat'
  | 'sit_radio'
  | 'sit_talk'
  | 'sit_doze'
  | 'sleep'
  | 'lie'
  | 'talk'
  | 'argue'
  | 'check_docs'
  | 'show_papers'
  | 'command'
  | 'write'
  | 'point'
  | 'smoke'
  | 'doze'
  | 'cover'
  | 'cook'
  | 'inspect'
  | 'binoculars'
  | 'phone'
  | 'pickup';

export type CarryKind = 'crate' | 'shell' | 'canister' | 'box' | 'stretcher' | null;

/** Шаг плана NPC — простые данные, чтобы план можно было сохранить. */
export type Step =
  | { k: 'go'; x: number; z: number; run?: boolean; spot?: string; tol?: number }
  | { k: 'do'; anim: AnimId; dur: number; yaw?: number; spot?: string; tag?: string }
  | { k: 'follow'; target: string; dist: number; run?: boolean; until?: number }
  | { k: 'station'; gun: GunId; slot: number }
  | { k: 'say'; text: string; quiet?: boolean }
  | { k: 'call'; fn: string; a?: any }
  | { k: 'wait'; cond: string; a?: any; max: number; anim?: AnimId };

export interface PersonalDocument {
  holder: string;
  rank: string;
  unit: string;
  position: string;
  clearance: Clearance;
  zones: AccessGroup[];
  serial: string;
  issued: string;
  issuedBy: string;
  age: number;
  /** Срок действия пропуска (игровой день), 0 — бессрочно. */
  validUntilDay: number;
}

export interface MemoryEntry {
  t: number;
  kind: 'order' | 'praise' | 'punish' | 'loss' | 'incident' | 'combat' | 'check' | 'talk' | 'event';
  text: string;
  w: number;
}

export interface Sighting {
  t: number;
  who: string;
  zone: ZoneId;
  note: 'offzone' | 'night' | 'tamper' | 'restricted' | 'stranger' | 'transmit';
}

export interface ActivityEntry {
  t: number;
  zone: ZoneId;
  act: string;
}

export interface Traits {
  /** Марка сигарет или null — не курит. */
  smokes: string | null;
  boot: number;
  leftHanded: boolean;
  talkative: number;
  brave: number;
  diligent: number;
}

export interface NpcState {
  id: string;
  first: string;
  last: string;
  rank: number;
  role: RoleId;
  unit: UnitId;
  position: string;
  age: number;
  /** Профессиональный опыт 0..100. */
  skill: number;
  serviceYears: number;
  history: string[];
  traits: Traits;
  shift: Shift;
  status: NpcStatus;

  health: number;
  fatigue: number;
  hunger: number;
  morale: number;
  discipline: number;
  /** Отношение к командиру 0..100. */
  attitude: number;

  x: number;
  z: number;
  yaw: number;
  zone: ZoneId;
  moving: boolean;
  run: boolean;
  path: number[] | null;
  pathI: number;
  /** Якорь позы: фигура визуально «пристёгнута» к мебели/вышке. */
  anchor: { x: number; z: number; y: number; yaw: number } | null;

  goal: string;
  goalData: any;
  goalScore: number;
  plan: Step[];
  stepI: number;
  stepT: number;
  stepInit: boolean;
  brainT: number;
  /** Запрет повторного выбора цели до указанного времени (после неудачи). */
  cooldowns: Record<string, number>;

  anim: AnimId;
  carry: CarryKind;
  armed: boolean;
  weaponOut: boolean;
  /** Жест поверх плана: приветствие, проверка документов, разговор с командиром. */
  gesture: { anim: AnimId; until: number; face?: string } | null;
  speech: { text: string; until: number } | null;

  bedSpot: string;
  workSpot: string;
  spot: string | null;
  task: string;

  doc: PersonalDocument;
  memory: MemoryEntry[];
  sightings: Sighting[];
  log: ActivityEntry[];
  lastSalute: number;
  lastCheck: number;
  /** Пропущен через КПП/пост (время последнего прохода по id поста). */
  passes: Record<string, number>;
  flags: Record<string, number | boolean | string>;
  hostile: boolean;
  seen: string[];
}

// ---------------------------------------------------------------- игрок

export interface PlayerState {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  health: number;
  zone: ZoneId;
  indoor: boolean;
  flashlight: boolean;
  /** Блокировка управления (диалог, панель, сон). */
  busy: boolean;
}

// ---------------------------------------------------------------- приказы

export type OrderStatus = 'issued' | 'accepted' | 'active' | 'done' | 'failed' | 'cancelled';

export interface Order {
  id: string;
  t: number;
  type: string;
  text: string;
  /** Кому отдан (NPC) и кто фактически исполняет. */
  to: string;
  executors: string[];
  status: OrderStatus;
  data: any;
  expires: number;
  note?: string;
}

// ---------------------------------------------------------------- артиллерия

export type ShellId = 'he21' | 'cp21' | 'smoke21' | 'he38' | 'sp38';

export type FireKind = 'single' | 'series' | 'salvo' | 'raid' | 'counter' | 'suppress';

export type GunPhase =
  | 'idle'
  | 'assembling'
  | 'deploying'
  | 'stowing'
  | 'relocating'
  | 'computing'
  | 'laying'
  | 'loading'
  | 'ready'
  | 'firing'
  | 'cover'
  | 'disabled';

export interface FireMission {
  id: string;
  t: number;
  kind: FireKind;
  guns: GunId[];
  /** Координаты цели на карте района, м. */
  tx: number;
  ty: number;
  targetName: string;
  intelId: string | null;
  shell: ShellId;
  rounds: number;
  /** Поправки командира: дальность (м) и направление (делений угломера). */
  corrRange: number;
  corrAz: number;
  status: 'pending' | 'active' | 'done' | 'cancelled';
  fired: number;
  reports: string[];
  /** Для подавления: время окончания. */
  until: number;
}

export interface GunState {
  id: GunId;
  phase: GunPhase;
  phaseT: number;
  phaseDur: number;
  /** Положение в мире и то, насколько установка выкачена (0 — укрыта, 1 — на позиции). */
  x: number;
  z: number;
  deploy: number;
  atAlt: boolean;
  wantDeploy: boolean;
  azimuth: number;
  elevation: number;
  targetAz: number;
  targetEl: number;
  loaded: ShellId | null;
  /** Состояние матчасти 0..100 и износ ствола 0..1. */
  condition: number;
  wear: number;
  /** Сбитый прицел (последствие саботажа): систематическая ошибка, м. */
  sightBias: number;
  niche: Partial<Record<ShellId, number>>;
  missionId: string | null;
  shotsInMission: number;
  totalShots: number;
  crew: string[];
  recoil: number;
  lastShotT: number;
  note: string;
  solution: FiringSolution | null;
}

export interface FiringSolution {
  ok: boolean;
  reason?: string;
  range: number;
  azimuth: number;
  elevation: number;
  v0: number;
  charge: number;
  tof: number;
}

export interface MetData {
  t: number;
  windSpeed: number;
  windDir: number;
  tempC: number;
  pressure: number;
}

// ---------------------------------------------------------------- противник и разведка

export type EnemyType = 'infantry' | 'armor' | 'artillery' | 'hq' | 'depot' | 'column' | 'recon' | 'decoy' | 'bridge';

export interface EnemyUnit {
  id: string;
  type: EnemyType;
  name: string;
  x: number;
  y: number;
  strength: number;
  suppress: number;
  state: 'advance' | 'hold' | 'dugin' | 'retreat' | 'move' | 'destroyed';
  camo: number;
  /** Маршрут по узлам дорожной сети. */
  route: number[];
  routeI: number;
  speed: number;
  /** За что себя выдаёт ложная позиция. */
  fakeType?: EnemyType;
  lastShelled: number;
  nextThink: number;
  fireCooldown: number;
  smokeUntil: number;
  objective: number;
  alive: boolean;
}

export type IntelSource = 'observer' | 'scouts' | 'intercept' | 'photo' | 'allied' | 'sound' | 'hq';

export interface IntelReport {
  id: string;
  t: number;
  /** Время, когда сведения были актуальны (могут быть устаревшими). */
  seenT: number;
  source: IntelSource;
  sourceName: string;
  /** Надёжность источника A..D. */
  grade: 'A' | 'B' | 'C' | 'D';
  type: EnemyType | 'unknown';
  x: number;
  y: number;
  /** Заявленная погрешность, м. */
  err: number;
  text: string;
  /** Скрытая связь с реальным подразделением (null — ложное донесение). */
  unitId: string | null;
  struck: boolean;
  archived: boolean;
}

export interface RadioMessage {
  id: string;
  t: number;
  from: string;
  subject: string;
  body: string;
  priority: 'routine' | 'urgent' | 'secret';
  read: boolean;
  delivered: boolean;
  kind?: string;
  data?: any;
}

// ---------------------------------------------------------------- оборудование и ресурсы

export type EquipmentId =
  | 'generator'
  | 'generator2'
  | 'radio'
  | 'switchboard'
  | 'ventilation'
  | 'truck1'
  | 'truck2'
  | 'gun1'
  | 'gun2'
  | 'gun3'
  | 'hoist'
  | 'searchlight';

export interface Equipment {
  id: EquipmentId;
  name: string;
  x: number;
  z: number;
  condition: number;
  broken: boolean;
  cause: 'wear' | 'sabotage' | 'damage' | null;
  diagnosed: boolean;
  /** Текст заключения механика после диагностики. */
  finding: string;
  priority: number;
  mechanic: string | null;
  progress: number;
  /** Работа необходима (ниже порога), даже если не сломано. */
  running: boolean;
}

export interface Resources {
  ammo: Record<ShellId, number>;
  fuel: number;
  food: number;
  medicine: number;
  parts: number;
}

export type SupplyItem = ShellId | 'fuel' | 'food' | 'medicine' | 'parts';

export interface SupplyRequest {
  id: string;
  t: number;
  items: Partial<Record<SupplyItem, number>>;
  escort: boolean;
  night: boolean;
  eta: number;
  status: 'requested' | 'enroute' | 'arrived' | 'lost' | 'partial' | 'unloading' | 'done';
  trucks: string[];
  drivers: string[];
  escorts: string[];
  note: string;
}

export interface HaulJob {
  id: string;
  from: Vec2;
  to: Vec2;
  item: SupplyItem | 'niche';
  amount: number;
  carry: CarryKind;
  state: 'open' | 'taken' | 'done';
  carrier: string | null;
  /** Кто может брать работу. */
  roles: RoleId[];
  gun?: GunId;
  requestId?: string;
  priority: number;
}

export interface Vehicle {
  id: string;
  kind: 'truck' | 'car';
  x: number;
  z: number;
  yaw: number;
  path: number[];
  pathI: number;
  state: 'parked' | 'driving' | 'away' | 'unloading' | 'wreck';
  speed: number;
  home: Vec2;
  homeYaw: number;
  onArrive: string;
}

// ---------------------------------------------------------------- охрана и контрразведка

export interface Patrol {
  id: string;
  name: string;
  leader: string;
  members: string[];
  route: string;
  /** Пользовательский маршрут (если route === 'custom'). */
  points: Vec2[];
  mode: 'route' | 'post' | 'follow' | 'reinforce' | 'respond';
  shiftStart: number;
  shiftEnd: number;
  clearance: Clearance;
  checkAll: boolean;
  wp: number;
  waitUntil: number;
  /** Точка, которую патруль занял/усиливает. */
  hold: Vec2 | null;
  active: boolean;
  temporary: boolean;
  lastReport: string;
  /** Идёт проверка документов: id задержанного. */
  checking: string | null;
  checkUntil: number;
}

export interface Evidence {
  id: string;
  t: number;
  suspect: string;
  kind: 'doc' | 'offzone' | 'tamper' | 'trait' | 'contradiction' | 'redhanded' | 'surveillance' | 'access' | 'contact' | 'testimony' | 'transmit';
  text: string;
  source: string;
  weight: number;
}

export interface SceneClue {
  id: string;
  t: number;
  place: string;
  text: string;
  /** Какой признак раскрывает улика. */
  trait: 'smokes' | 'boot' | 'leftHanded' | 'time' | 'role';
  value: string | number | boolean;
  found: boolean;
}

export interface CaseFile {
  suspect: string;
  opened: number;
  surveillance: boolean;
  restricted: boolean;
  status: 'open' | 'interrogation' | 'handed' | 'cleared' | 'convicted';
  notes: string[];
  handedAt: number;
}

export interface Sabotage {
  id: string;
  target: EquipmentId | 'ammo' | 'food' | 'fuel' | 'phone_line';
  culprit: string;
  plantedAt: number;
  triggerAt: number;
  triggered: boolean;
  discovered: boolean;
  defused: boolean;
  clueIds: string[];
}

// ---------------------------------------------------------------- миссии

export interface ObjectiveState {
  id: string;
  text: string;
  done: boolean;
  failed: boolean;
  optional: boolean;
}

export interface MissionState {
  chapter: number;
  chapterId: string;
  title: string;
  objectives: ObjectiveState[];
  flags: Record<string, number | boolean | string>;
  startedAt: number;
  ended: string | null;
  score: number;
}
