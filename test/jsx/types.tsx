// Type-level tests: checked by `pnpm typecheck` (never run). `@ts-expect-error` lines MUST error.
import { createSignal } from 'frameact';
import { For, Match, Show, Switch } from 'frameact/dom';

const handler = (_e: MouseEvent) => {};
const [text] = createSignal('');
const [on] = createSignal(false);
const [user] = createSignal<{ title: string } | null>(null);
const [count] = createSignal<number | undefined>(undefined);

export function accepted() {
  return [
    <div onClick={handler} />,
    <div class:active={true} />,
    <div style:color="red" />,
    <div style:opacity={0.5} />,
    <div on:click={handler} />,
    <div on:click={{ handleEvent: handler, passive: true }} />,
    <div on:custom-event={handler} />,
    <div oncapture:click={handler} />,
    <div attr:data-x="1" />,
    <div attr:aria-hidden={true} />,
    <input bool:disabled={true} />,
    <iframe prop:srcdoc="<p>x</p>" />,
    <div prop:anything={1} />,
    <div attr:onclick={null} />,
    <input use:value={text} />,
    <textarea use:value={text} />,
    <select use:value={text} />,
    <input type="checkbox" use:checked={on} />,
    <div class={['a', { b: true }]} />,
    <For each={[1]} order="manual" orderKey={(n: number) => n}>{(n) => <i>{n}</i>}</For>,
    // Show/Match function children: the parameter is inferred under strict (no implicit any), narrowed to NonNullable
    <Show when={user()}>{(u) => <b>{u().title}</b>}</Show>,
    <Show when={user()} keyed>{(u) => <b>{u.title}</b>}</Show>,
    <Show when={user()} fallback={<i />}>{(u) => u().title}</Show>,
    <Show when={user()}><b /></Show>,
    <Switch fallback={<i />}>
      <Match when={user()}>{(u) => <b>{u().title}</b>}</Match>
      <Match when={count()} keyed>{(n) => <b>{n.toFixed(1)}</b>}</Match>
      <Match when={on()}><u /></Match>
    </Switch>,
  ];
}

export function rejected() {
  // lowercase on* compiles to setAttribute(el, "onclick", f), which the runtime refuses
  // @ts-expect-error
  void (<div onclick={handler} />);
  // @ts-expect-error
  void (<div onclick="alert(1)" />);
  // @ts-expect-error
  void (<div onClick="alert(1)" />);
  // @ts-expect-error
  void (<div attr:onclick="alert(1)" />);
  // @ts-expect-error
  void (<input use:value={{}} />);
  // @ts-expect-error
  void (<div use:value={text} />);
  // @ts-expect-error
  void (<div use:checked={on} />);
  // @ts-expect-error
  void (<input use:nope={text} />);
  // @ts-expect-error
  void (<For each={[1]} order="auto">{(n) => <i>{n}</i>}</For>);
  // @ts-expect-error
  void (<div class:active="yes" />);
  // the narrowed accessor is an accessor, not the value
  // @ts-expect-error
  void (<Show when={user()}>{(u) => u.title}</Show>);
  // keyed receives the value, not an accessor
  // @ts-expect-error
  void (<Show when={user()} keyed>{(u) => u().title}</Show>);
  // @ts-expect-error
  void (<Match when={user()}>{(u) => u.title}</Match>);
  // the value is NonNullable: no null left
  // @ts-expect-error
  void (<Show when={user()} keyed>{(u) => u.nope}</Show>);
}
