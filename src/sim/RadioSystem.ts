import type { RadioMessage } from '../core/types';
import type { Sim } from './Sim';

/**
 * Журнал радиограмм и донесений. Срочные сообщения приносит командиру посыльный
 * (дежурный радист); если связи нет — радиограммы штаба ждут её восстановления.
 */
export class RadioSystem {
  state = { messages: [] as RadioMessage[], pending: [] as RadioMessage[], seq: 0, lastTransmit: 0 };

  constructor(private sim: Sim) {}

  reset(): void {
    this.state = { messages: [], pending: [], seq: 0, lastTransmit: 0 };
  }

  get messages(): RadioMessage[] {
    return this.state.messages;
  }

  send(from: string, subject: string, body: string, priority: RadioMessage['priority'] = 'routine', kind?: string, data?: any, viaRadio = true): RadioMessage {
    const msg: RadioMessage = { id: 'm' + ++this.state.seq, t: this.sim.now, from, subject, body, priority, read: false, delivered: false, kind, data };
    if (viaRadio && !this.sim.resources.state.radio) {
      this.state.pending.push(msg);
      return msg;
    }
    this.accept(msg);
    return msg;
  }

  private accept(msg: RadioMessage): void {
    msg.t = this.sim.now;
    this.state.messages.push(msg);
    if (this.state.messages.length > 120) this.state.messages.shift();
    this.sim.bus.emit('radio:message', { msg });
    if (msg.priority === 'routine') this.deliver(msg);
    else msg.data = { ...(msg.data ?? {}), deadline: this.sim.clock + 75 };
  }

  /** Сообщение вручено командиру. */
  deliver(msg: RadioMessage): void {
    if (msg.delivered) return;
    msg.delivered = true;
    this.sim.bus.emit('radio:delivered', { msg });
  }

  /** Первое срочное сообщение, которое ещё не вручено. */
  undelivered(): RadioMessage | null {
    return this.state.messages.find((m) => !m.delivered) ?? null;
  }

  unread(): number {
    return this.state.messages.filter((m) => m.delivered && !m.read).length;
  }

  update(): void {
    const s = this.state;
    if (s.pending.length && this.sim.resources.state.radio) {
      for (const m of s.pending.splice(0)) this.accept(m);
    }
    // если посыльный не дошёл — сообщение передают по внутренней связи
    for (const m of s.messages) {
      if (!m.delivered && m.data?.deadline !== undefined && this.sim.clock > m.data.deadline) this.deliver(m);
    }
  }

  save(): unknown {
    return this.state;
  }

  load(d: any): void {
    this.state = d;
  }
}
