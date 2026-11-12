import { simText } from './strings.js';

/** @param {{part:string|null,projectId:string|null,projectAddress?:()=>('0x76'|'0x77'),enqueue(request:import('../lab-handoff.js').Request):boolean,navigate():void,onError():void}} opts */
export function createLabActions(opts) {
  const element = document.createElement('section');
  element.className = 'lab-actions';
  /** @type {{button:HTMLButtonElement,key:string}[]} */ const buttons = [];
  /** @param {string} key @param {import('../lab-handoff.js').Request} request */
  const add = (key, request) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.addEventListener('click', () => {
      const current = request.kind === 'project' && opts.projectAddress ? { ...request, address: opts.projectAddress() } : request;
      if (opts.enqueue(current)) opts.navigate(); else opts.onError();
    });
    buttons.push({ button, key });
    element.append(button);
  };
  if (opts.part) add('lab.addToBench', { kind: 'add', part: opts.part });
  if (opts.projectId) add('lab.startProject', { kind: 'project', projectId: opts.projectId });
  const setLanguage = (/** @type {string} */ lang) => { for (const { button, key } of buttons) button.textContent = simText(lang, key); };
  setLanguage('en');
  return { element, setLanguage };
}
