/**
 * Visual of one live summon: real Quaternius model + its own animations,
 * interpolated from server state, with a small name/health tag.
 */
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { SUMMON_ACTIONS, SummonMode, type SummonDefinition } from '@openworld/shared';
import type { CharacterTemplate } from '../assets/AssetLibrary.ts';
import { AnimatedModel } from '../game/AnimatedModel.ts';
import { Interpolator } from '../game/Interpolator.ts';

export interface NetSummon {
  ownerId: string; kind: string; x: number; y: number; z: number; yaw: number;
  hp: number; maxHp: number; mode: SummonMode; action: number; actionSeq: number; target: string;
}

const LOCOMOTION = new Set(['idle', 'walk', 'run']);

export class SummonView {
  readonly anim: AnimatedModel;
  readonly interp = new Interpolator();
  readonly tag: CSS2DObject;
  private hpFill: HTMLDivElement;
  private label: HTMLDivElement;
  private lastSeq = -1;
  private appear = 0;
  last: NetSummon;

  constructor(readonly def: SummonDefinition, template: CharacterTemplate, net: NetSummon, ownerName: string, readonly mine: boolean) {
    this.anim = new AnimatedModel(template, def.scale);
    if (def.flying) this.anim.model.position.y = 0.9;
    this.last = net;
    this.interp.reset(net);
    const el = document.createElement('div');
    el.className = `summon-tag${mine ? ' mine' : ''}`;
    this.label = document.createElement('div');
    this.label.className = 'summon-name';
    this.label.textContent = `${def.name} · ${ownerName}`;
    const bar = document.createElement('div');
    bar.className = 'hpbar';
    this.hpFill = document.createElement('div');
    bar.append(this.hpFill);
    el.append(this.label, bar);
    this.tag = new CSS2DObject(el);
    this.tag.position.y = (def.flying ? 3.1 : 2.4) * (def.scale / 0.6);
    this.anim.root.add(this.tag);
    this.anim.root.scale.setScalar(0.01); // grows in during the arrival
  }

  push(t: number, s: NetSummon): void {
    this.last = s;
    this.interp.push(t, s);
  }

  setOwnerName(name: string): void {
    this.label.textContent = `${this.def.name} · ${name}`;
  }

  update(now: number, dt: number, originX: number, originZ: number, distance: number): void {
    const p = this.interp.update(now);
    this.anim.root.position.set(p.x - originX, p.y, p.z - originZ);
    this.anim.root.rotation.y = p.yaw;
    this.appear = Math.min(1, this.appear + dt / 0.6);
    const e = 1 - Math.pow(1 - this.appear, 3);
    this.anim.root.scale.setScalar(Math.max(0.01, e));

    const s = this.last;
    const slot = SUMMON_ACTIONS[s.action] ?? 'idle';
    const clip = this.def.animations[slot] ?? this.def.animations.idle;
    if (s.actionSeq !== this.lastSeq && !LOCOMOTION.has(slot)) {
      this.lastSeq = s.actionSeq;
      this.anim.once(clip, slot === 'death');
    } else if (LOCOMOTION.has(slot)) {
      this.lastSeq = s.actionSeq;
      this.anim.loop(clip, slot === 'run' ? 1.15 : 1);
    }
    this.anim.update(dt);

    const ratio = s.maxHp > 0 ? s.hp / s.maxHp : 0;
    this.hpFill.style.width = `${Math.round(ratio * 100)}%`;
    this.hpFill.style.background = ratio > 0.5 ? '#5cd65c' : ratio > 0.25 ? '#f0c040' : '#e05050';
    this.tag.visible = distance < 70 && s.mode !== SummonMode.Dead;
  }

  /** World position (interpolated). */
  get world(): { x: number; y: number; z: number } {
    return this.interp.current;
  }

  dispose(): void {
    this.tag.element.remove();
    this.anim.dispose();
  }
}

