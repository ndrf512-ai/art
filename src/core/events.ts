import type {
  AlertLevel,
  EquipmentId,
  Evidence,
  FireMission,
  GunId,
  IntelReport,
  Order,
  RadioMessage,
  ShellId,
  SupplyRequest,
  ZoneId,
} from './types';

export type NotifyKind = 'info' | 'warn' | 'alarm' | 'good' | 'radio' | 'order';

/** Карта событий игры. Системы публикуют события и подписываются на чужие. */
export interface Events {
  'time:hour': { hour: number; day: number };
  'time:day': { day: number };
  'weather:changed': { kind: string };
  'alert:changed': { level: AlertLevel; prev: AlertLevel; reason: string };
  notify: { text: string; kind: NotifyKind };
  'npc:speech': { id: string; text: string; quiet: boolean };
  'npc:spawned': { id: string };
  'npc:removed': { id: string };
  'npc:wounded': { id: string; cause: string };
  'npc:died': { id: string; cause: string };
  'npc:status': { id: string };
  'npc:salute': { id: string };
  'order:issued': { order: Order };
  'order:updated': { order: Order };
  'arty:phase': { gun: GunId; phase: string };
  'arty:shot': { gun: GunId; shell: ShellId; x: number; z: number; azimuth: number };
  'arty:report': { gun: GunId | null; text: string };
  'arty:mission': { mission: FireMission };
  'intel:new': { report: IntelReport };
  'enemy:destroyed': { id: string; type: string; name: string };
  'enemy:shelling': { rounds: number };
  'radio:message': { msg: RadioMessage };
  'radio:delivered': { msg: RadioMessage };
  'power:changed': { on: boolean; backup: boolean };
  'comms:changed': { radio: boolean; wire: boolean };
  'equipment:broken': { id: EquipmentId; cause: string };
  'equipment:repaired': { id: EquipmentId };
  'resource:low': { kind: string };
  'supply:update': { request: SupplyRequest };
  'world:explosion': { x: number; z: number; size: number; kind: 'shell' | 'bomb' | 'charge' };
  'world:gunshot': { x: number; z: number; tx: number; tz: number };
  'world:fire': { x: number; z: number; on: boolean; id: string };
  'world:plane': { hostile: boolean };
  'ci:evidence': { evidence: Evidence };
  'ci:case': { suspect: string };
  'doc:checked': { checker: string; target: string; ok: boolean; issues: string[]; zone: ZoneId };
  'dialogue:talked': { id: string };
  'mission:updated': {};
  'mission:chapter': { title: string; intro: string[] };
  'campaign:ended': { outcome: string; title: string; text: string[] };
  'save:done': { slot: string };
  'load:done': { slot: string };
  'vehicle:moved': { id: string };
  'player:hurt': { amount: number };
  'player:knockout': { hours: number };
  'ui:open': { panel: string; arg?: any };
  'phone:ring': { x: number; z: number };
}
