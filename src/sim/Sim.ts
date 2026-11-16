/**
 * Sim — корень симуляции. Создаёт независимые системы, связывает их шиной событий
 * и общими интерфейсами, шагает мир и умеет целиком сохранять/восстанавливать его.
 * Не зависит от графики: тот же код работает в браузере и в тестах на Node.
 */
import { GMIN_PER_SEC, SAVE_VERSION } from '../core/constants';
import { EventBus } from '../core/EventBus';
import type { Events, NotifyKind } from '../core/events';
import { Rng } from '../core/Rng';
import type { NpcState, PlayerState } from '../core/types';
import type { Grid } from '../world/Grid';
import { buildLayout, type Layout } from '../world/layout';
import { Pathfinder } from '../world/Pathfinder';
import { AccessControlSystem } from './AccessControlSystem';
import { AlertSystem } from './AlertSystem';
import { ArtilleryCrewAI } from './ArtilleryCrewAI';
import { ArtillerySystem } from './ArtillerySystem';
import { BallisticsSystem } from './BallisticsSystem';
import { CombatSystem } from './CombatSystem';
import { CommandSystem } from './CommandSystem';
import { CounterIntelligenceSystem } from './CounterIntelligenceSystem';
import { DialogueSystem } from './DialogueSystem';
import { DocumentSystem, fullName } from './DocumentSystem';
import { EnemySystem } from './EnemySystem';
import { EventDirector } from './EventDirector';
import { GuardAI } from './GuardAI';
import { MissionSystem } from './MissionSystem';
import { buildRoster } from './npc/roster';
import { NPCSchedule } from './NPCSchedule';
import { NPCSystem } from './NPCSystem';
import { OfficerSystem } from './OfficerSystem';
import { PatrolSystem } from './PatrolSystem';
import { RadioSystem } from './RadioSystem';
import { ReconSystem } from './ReconSystem';
import { RelationshipSystem } from './RelationshipSystem';
import { RepairSystem } from './RepairSystem';
import { ResourceSystem } from './ResourceSystem';
import { SabotageSystem } from './SabotageSystem';
import { SecurityZone } from './SecurityZone';
import { SpySystem } from './SpySystem';
import { SupplySystem } from './SupplySystem';
import { WeatherSystem } from './WeatherSystem';
import { WorldTimeSystem } from './WorldTimeSystem';

export type Gender = 'm' | 'f';

export interface PlayerSim extends PlayerState {
  gender: Gender;
}

export interface SaveData {
  v: number;
  seed: number;
  rng: number;
  clock: number;
  player: PlayerSim;
  sys: Record<string, unknown>;
}

export class Sim {
  readonly bus = new EventBus<Events>();
  rng: Rng;
  seed: number;
  layout: Layout;
  grid: Grid;
  path: Pathfinder;
  /** Реальные секунды симуляции (для жестов, таймеров анимаций). */
  clock = 0;
  player: PlayerSim;
  /** Именованные обратные вызовы для шагов планов NPC (план хранит только имя). */
  readonly calls: Record<string, (npc: NpcState, arg: any) => void> = {};
  readonly conds: Record<string, (npc: NpcState, arg: any) => boolean> = {};

  readonly time: WorldTimeSystem;
  readonly weather: WeatherSystem;
  readonly zones: SecurityZone;
  readonly access: AccessControlSystem;
  readonly docs: DocumentSystem;
  readonly npcs: NPCSystem;
  readonly schedule: NPCSchedule;
  readonly resources: ResourceSystem;
  readonly repair: RepairSystem;
  readonly alert: AlertSystem;
  readonly radio: RadioSystem;
  readonly guard: GuardAI;
  readonly patrols: PatrolSystem;
  readonly ballistics: BallisticsSystem;
  readonly artillery: ArtillerySystem;
  readonly crewAI: ArtilleryCrewAI;
  readonly supply: SupplySystem;
  readonly enemy: EnemySystem;
  readonly recon: ReconSystem;
  readonly spy: SpySystem;
  readonly sabotage: SabotageSystem;
  readonly ci: CounterIntelligenceSystem;
  readonly relations: RelationshipSystem;
  readonly officers: OfficerSystem;
  readonly command: CommandSystem;
  readonly combat: CombatSystem;
  readonly events: EventDirector;
  readonly missions: MissionSystem;
  readonly dialogue: DialogueSystem;

  private readonly persistent: [string, { save(): unknown; load(d: any): void; reset?(): void }][];

  constructor(seed = 1944) {
    this.seed = seed;
    this.rng = new Rng(seed);
    this.layout = buildLayout();
    this.grid = this.layout.grid;
    this.path = new Pathfinder(this.grid);
    this.player = this.freshPlayer('m');

    this.time = new WorldTimeSystem(this);
    this.weather = new WeatherSystem(this);
    this.zones = new SecurityZone(this);
    this.access = new AccessControlSystem(this);
    this.docs = new DocumentSystem(this);
    this.npcs = new NPCSystem(this);
    this.schedule = new NPCSchedule(this);
    this.resources = new ResourceSystem(this);
    this.repair = new RepairSystem(this);
    this.alert = new AlertSystem(this);
    this.radio = new RadioSystem(this);
    this.guard = new GuardAI(this);
    this.patrols = new PatrolSystem(this);
    this.ballistics = new BallisticsSystem();
    this.artillery = new ArtillerySystem(this);
    this.crewAI = new ArtilleryCrewAI(this);
    this.supply = new SupplySystem(this);
    this.enemy = new EnemySystem(this);
    this.recon = new ReconSystem(this);
    this.spy = new SpySystem(this);
    this.sabotage = new SabotageSystem(this);
    this.ci = new CounterIntelligenceSystem(this);
    this.relations = new RelationshipSystem(this);
    this.officers = new OfficerSystem(this);
    this.command = new CommandSystem(this);
    this.combat = new CombatSystem(this);
    this.events = new EventDirector(this);
    this.missions = new MissionSystem(this);
    this.dialogue = new DialogueSystem(this);

    this.persistent = [
      ['time', this.time],
      ['weather', this.weather],
      ['zones', this.zones],
      ['access', this.access],
      ['docs', this.docs],
      ['npcs', this.npcs],
      ['resources', this.resources],
      ['repair', this.repair],
      ['alert', this.alert],
      ['radio', this.radio],
      ['guard', this.guard],
      ['patrols', this.patrols],
      ['artillery', this.artillery],
      ['supply', this.supply],
      ['enemy', this.enemy],
      ['recon', this.recon],
      ['spy', this.spy],
      ['sabotage', this.sabotage],
      ['ci', this.ci],
      ['relations', this.relations],
      ['officers', this.officers],
      ['command', this.command],
      ['combat', this.combat],
      ['events', this.events],
      ['missions', this.missions],
    ];

    // провайдеры целей NPC: каждая система предлагает своё, NPC выбирает сам
    const p = this.npcs.providers;
    p.push((n) => this.schedule.option(n));
    p.push((n) => this.guard.option(n));
    p.push((n) => this.patrols.option(n));
    p.push((n) => this.crewAI.option(n));
    p.push((n) => this.repair.option(n));
    p.push((n) => this.supply.option(n));
    p.push((n) => this.supply.driverOption(n));
    p.push((n) => this.ci.option(n));
    p.push((n) => this.spy.option(n));
    p.push((n) => this.combat.option(n));
    p.push((n) => this.command.option(n));
    p.push((n) => this.events.option(n));
    p.push((n) => this.messengerOption(n));
    this.calls['radio.hand'] = (n) => this.handMessage(n);
  }

  private freshPlayer(gender: Gender): PlayerSim {
    const p = this.layout.points.spawn_player;
    return { x: p.x, z: p.z, yaw: Math.PI, pitch: 0, health: 100, zone: 'outside', indoor: false, flashlight: false, busy: false, gender };
  }

  get now(): number {
    return this.time.t;
  }

  notify(text: string, kind: NotifyKind = 'info'): void {
    this.bus.emit('notify', { text, kind });
  }

  /** Обращение к командиру: «господин оберст» / «госпожа оберст». */
  address(cap = false): string {
    const s = this.player.gender === 'f' ? 'госпожа оберст' : 'господин оберст';
    return cap ? s[0].toUpperCase() + s.slice(1) : s;
  }

  private freshWorld(): void {
    this.layout = buildLayout();
    this.grid = this.layout.grid;
    this.path = new Pathfinder(this.grid);
  }

  /** Новая кампания. */
  newGame(opts: { seed?: number; gender?: Gender } = {}): void {
    this.seed = opts.seed ?? (Date.now() & 0x7fffffff);
    this.rng = new Rng(this.seed);
    this.clock = 0;
    this.freshWorld();
    this.player = this.freshPlayer(opts.gender ?? 'm');
    this.dialogue.close();
    this.time.reset();
    this.weather.reset();
    this.zones.reset();
    this.access.reset();
    this.docs.reset();
    this.npcs.reset();
    this.resources.reset();
    this.repair.reset();
    this.alert.reset();
    this.radio.reset();
    this.guard.reset();
    this.patrols.reset();
    buildRoster(this);
    this.officers.reset();
    this.officers.init();
    this.artillery.reset();
    this.crewAI.reset();
    this.supply.reset();
    this.enemy.reset();
    this.recon.reset();
    this.spy.reset();
    this.sabotage.reset();
    this.ci.reset();
    this.relations.reset();
    this.command.reset();
    this.combat.reset();
    this.events.reset();
    this.missions.reset();
    this.patrols.createDefaults();
    this.spy.plant();
    this.placeAtStart();
    this.missions.start();
  }

  /** Расстановка на 05:40 первого дня: ночная смена на службе, начальник штаба встречает у КПП. */
  private placeAtStart(): void {
    const L = this.layout;
    for (const n of this.npcs.list) {
      if (n.shift === 'night') {
        const sp = L.byTag(n.workSpot)[0];
        if (sp && n.role !== 'guard' && n.role !== 'patrol_leader') {
          n.x = sp.x;
          n.z = sp.z;
        } else {
          const bench = L.byTag('guard_bench')[0];
          n.x = bench.x + this.rng.range(-2, 2);
          n.z = bench.z - 1;
        }
        n.zone = this.grid.zoneAt(n.x, n.z);
        n.fatigue = 55;
      }
    }
    // дневная смена уже поднята и идёт на построение
    for (const n of this.npcs.list) {
      if (n.shift === 'night' || n.unit === 'external') continue;
      n.fatigue = Math.min(n.fatigue, 20);
    }
    const posts = ['post_kpp_1', 'post_secret_1', 'post_kpp_2', 'post_tower_1', 'post_hangar_1'];
    const guards = this.npcs.list.filter((n) => n.role === 'guard' && n.shift === 'night');
    posts.forEach((p, i) => {
      const g = guards[i + 1];
      const sp = L.spotById[p];
      if (!g || !sp) return;
      g.x = sp.x;
      g.z = sp.z;
      g.zone = this.grid.zoneAt(g.x, g.z);
      this.guard.state.holder[p] = g.id;
    });
    const adj = this.npcs.first('adjutant');
    if (adj) {
      adj.x = L.points.gate_in.x + 1.2;
      adj.z = L.points.gate_in.z + 1;
      adj.yaw = 0;
      adj.zone = this.grid.zoneAt(adj.x, adj.z);
    }
  }

  /** Посыльный: дежурный радист несёт срочную радиограмму командиру. */
  private messengerOption(n: NpcState) {
    if (n.status !== 'active' || (n.role !== 'radio_op' && n.role !== 'adjutant')) return null;
    const msg = this.radio.undelivered();
    if (!msg) return null;
    if (n.role === 'radio_op' && !this.schedule.onDuty(n)) return null;
    if (n.role === 'adjutant' && this.npcs.list.some((o) => o.role === 'radio_op' && o.status === 'active' && this.schedule.onDuty(o))) return null;
    const p = this.player;
    const d = Math.hypot(p.x - n.x, p.z - n.z);
    return {
      key: `messenger:${msg.id}`,
      score: 72,
      task: 'Несёт срочное донесение командиру',
      plan: () =>
        d < 3
          ? [{ k: 'call' as const, fn: 'radio.hand' }, { k: 'do' as const, anim: 'attention' as const, dur: 1.5 }]
          : [{ k: 'follow' as const, target: 'player', dist: 2.4, run: true, until: this.now + 3 }],
    };
  }

  private handMessage(n: NpcState): void {
    const msg = this.radio.undelivered();
    if (!msg) return;
    this.npcs.gesture(n, 'salute', 1.8, 'player');
    this.npcs.speak(n, `${this.address(true)}, ${msg.priority === 'secret' ? 'секретный пакет' : 'срочное донесение'}: ${msg.subject}.`);
    this.radio.deliver(msg);
    void fullName;
  }

  /** Один шаг мира. dt — реальные секунды (не больше 0.1 для устойчивости). */
  update(dt: number): void {
    const gdt = dt * GMIN_PER_SEC;
    this.clock += dt;
    this.time.update(dt, gdt);
    this.weather.update(dt, gdt);
    this.repair.update(dt, gdt);
    this.resources.update(dt, gdt);
    this.radio.update();
    this.npcs.update(dt, gdt);
    this.patrols.update();
    this.artillery.update(dt, gdt);
    this.crewAI.update(dt, gdt);
    this.supply.update(dt);
    this.enemy.update(dt, gdt);
    this.recon.update(dt, gdt);
    this.sabotage.update();
    this.ci.update();
    this.relations.update(dt, gdt);
    this.command.update();
    this.combat.update(dt, gdt);
    this.events.update();
    this.missions.update(dt);
  }

  // ------------------------------------------------------------------ сохранение

  serialize(): SaveData {
    const sys: Record<string, unknown> = {};
    for (const [name, s] of this.persistent) sys[name] = s.save();
    return JSON.parse(JSON.stringify({ v: SAVE_VERSION, seed: this.seed, rng: this.rng.s, clock: this.clock, player: this.player, sys }));
  }

  deserialize(data: SaveData): void {
    if (data.v !== SAVE_VERSION) throw new Error('Сохранение создано другой версией игры.');
    const d: SaveData = JSON.parse(JSON.stringify(data));
    this.freshWorld();
    this.seed = d.seed;
    this.rng = new Rng(d.seed);
    this.rng.s = d.rng;
    this.clock = d.clock;
    this.player = d.player;
    this.player.busy = false;
    this.dialogue.close();
    this.crewAI.reset();
    for (const [name, s] of this.persistent) s.load(d.sys[name]);
    this.access.invalidate();
  }
}
