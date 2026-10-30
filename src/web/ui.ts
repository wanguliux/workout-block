/*
 * ui.ts —— 网页端通用反馈层：toast、模态框、二次确认。
 * 所有页面共用 #modalRoot / #toast，事件由 app.ts 统一委托。
 */

import { esc, L } from './format';
import { icon } from './icons';

let toastTimer = 0;
let pendingConfirm: (() => void) | null = null;

export function toast(message: string): void {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el?.classList.remove('show'), 2000);
}

function modalRoot(): HTMLElement | null {
  return document.getElementById('modalRoot');
}

export function showModal(html: string): void {
  const root = modalRoot();
  if (root) root.innerHTML = html;
}

export function closeModal(): void {
  pendingConfirm = null;
  const root = modalRoot();
  if (root) root.innerHTML = '';
}

export interface ModalOptions {
  title: string;
  sub?: string;
  body: string;
  foot: string;
  large?: boolean;
}

export function modalFrame(options: ModalOptions): string {
  return (
    '<div class="modal-backdrop" data-action="backdrop">' +
    `<div class="modal${options.large ? ' modal-lg' : ''}" role="dialog" aria-modal="true">` +
    '<div class="modal-head"><div>' +
    `<h3>${esc(options.title)}</h3>` +
    (options.sub ? `<p>${esc(options.sub)}</p>` : '') +
    '</div><button class="icon-btn" data-action="close-modal" aria-label="close">' +
    icon('x') +
    '</button></div>' +
    `<div class="modal-body">${options.body}</div>` +
    `<div class="modal-foot">${options.foot}</div>` +
    '</div></div>'
  );
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
}

export function confirmDialog(options: ConfirmOptions): void {
  pendingConfirm = options.onConfirm;
  const foot =
    '<button class="btn btn-ghost" data-action="close-modal">' +
    esc(L('取消', 'Cancel')) +
    '</button>' +
    `<button class="btn ${options.danger ? 'btn-danger' : 'btn-primary'}" data-action="confirm-yes">` +
    esc(options.confirmLabel ?? L('确认', 'Confirm')) +
    '</button>';
  showModal(
    modalFrame({
      title: options.title,
      body: `<div class="muted" style="font-size:13px;line-height:1.7">${options.message}</div>`,
      foot,
    })
  );
}

/** 「确认」按钮的统一入口：先关闭弹窗，再执行回调。 */
export function acceptConfirm(): void {
  const cb = pendingConfirm;
  pendingConfirm = null;
  closeModal();
  cb?.();
}

export function emptyState(text: string, hint?: string): string {
  return `<div class="empty">${esc(text)}${hint ? `<div class="faint" style="margin-top:4px">${esc(hint)}</div>` : ''}</div>`;
}
