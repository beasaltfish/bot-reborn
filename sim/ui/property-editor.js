// Reusable schema-driven controls; values remain owned by the bench.
/**
 * @param {Record<string, import('../devices/catalog.js').PropertyDef>} schema
 * @param {Record<string, number|string|boolean>} values
 * @param {(key:string, value:number|string|boolean) => void} onChange
 */
export function createPropertyEditor(schema, values, onChange) {
  const element = document.createElement('div');
  /** @type {Map<string, HTMLInputElement|HTMLSelectElement>} */
  const controls = new Map();
  for (const [key, def] of Object.entries(schema)) {
    const label = document.createElement('label');
    label.textContent = `${key}${def.kind === 'number' && def.unit ? ` (${def.unit})` : ''} `;
    /** @type {HTMLInputElement|HTMLSelectElement} */
    let input;
    if (def.kind === 'enum') {
      const select = document.createElement('select');
      for (const value of def.values) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        select.append(option);
      }
      select.addEventListener('change', () => { if (def.values.includes(select.value)) onChange(key, select.value); });
      input = select;
    } else {
      const field = document.createElement('input');
      if (def.kind === 'number') {
        field.type = 'number';
        if (def.min !== undefined) field.min = String(def.min);
        if (def.max !== undefined) field.max = String(def.max);
        field.step = def.step === undefined ? 'any' : String(def.step);
        field.addEventListener('change', () => {
          if (field.checkValidity() && Number.isFinite(field.valueAsNumber)) onChange(key, field.valueAsNumber);
        });
      } else {
        field.type = 'checkbox';
        field.addEventListener('change', () => onChange(key, field.checked));
      }
      input = field;
    }
    controls.set(key, input);
    label.append(input);
    element.append(label);
  }
  /** @param {Record<string, number|string|boolean>} next */
  function update(next) {
    for (const [key, control] of controls) {
      if (!Object.hasOwn(next, key)) continue;
      if (control.tagName === 'INPUT' && control.type === 'checkbox') /** @type {HTMLInputElement} */ (control).checked = next[key] === true;
      else control.value = String(next[key]);
    }
  }
  update(values);
  return { element, update };
}
