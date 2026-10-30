(function () {
  'use strict';
  const registry = window.FoundationExperiments ??= {};
  const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
  const choiceIndex = state => Math.round(clamp(state.choice, 0, 3));
  const progressValue = state => clamp(state.progress, 0, 100);
  const choices = source => source.texts.slice(5, 9);
  const destinationY = choice => 12.5 + choice * 25;
  const route = choice => `M 34 50 L 47 50 L 65 ${destinationY(choice)}`;

  function render(ctx) {
    const { source, state, esc } = ctx;
    const list = choices(source), choice = choiceIndex(state), progress = progressValue(state);
    const invitation = String(source.texts[2]).split(/(?<=\.)\s+/);
    return `<section class="scene experiment fear-experiment" data-experiment="6" aria-labelledby="sceneTitle">
      <div class="fear-shutter" data-fear-field>${window.FoundationStormMarkup(true)}</div>
      <header class="ex-head fear-head">
        <div class="fear-heading er-hidden-heading"><p class="fear-kicker">${esc(source.kicker)}</p><h1 id="sceneTitle">${esc(source.title)}</h1></div>
        <button type="button" class="fear-why-toggle" data-fear-why aria-haspopup="dialog" aria-expanded="false">WHY <span aria-hidden="true">↗</span></button>
      </header>
      <div class="ex-body fear-body">
        <p class="fear-invitation"><span>${esc(invitation[0])}</span> <strong>${esc(invitation.slice(1).join(' '))}</strong></p>
        <div class="fear-chamber" data-fear-chamber data-no-swipe>
          <strong class="fear-shutter-word">FEAR</strong>
          <div class="fear-choice-map"><svg class="fear-path-map" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            ${list.map((_,i)=>`<path class="fear-guide" d="${route(i)}"></path>`).join('')}
            <path class="fear-route" data-fear-route d="${route(choice)}" pathLength="100"></path>
          </svg>
          <div class="fear-progress-marker" data-fear-marker role="slider" tabindex="0" aria-label="Move toward the selected action while fear remains" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span aria-hidden="true">→</span></div>
          <div class="fear-destinations" role="group" aria-label="Choose what comes next">
            ${list.map((text,i)=>`<button type="button" data-fear-choice="${i}" aria-pressed="${i===choice}">${esc(text)}</button>`).join('')}
          </div>
        </div></div>
        <div class="fear-controls"><span class="fear-move-label" aria-hidden="true">MOVE WITH FEAR</span><input type="range" class="fear-range" data-fear-range min="0" max="100" step="1" value="${progress}" aria-label="Progress toward ${esc(list[choice])} while fear remains"><button type="button" class="fear-reset" data-fear-reset aria-label="Return to the start while keeping the selected action">↺</button></div>
      </div>
      <dialog class="fear-why-dialog" data-fear-dialog data-no-swipe aria-labelledby="fearWhyTitle"><div class="fear-dialog-head"><h2 id="fearWhyTitle">AFTER THE FEAR</h2><button type="button" data-fear-close aria-label="Close explanation">×</button></div><p>${esc(source.texts[3])}</p><p>${esc(source.texts[4])}</p></dialog>
    </section>`;
  }

  function bind(ctx) {
    const { root, set } = ctx;
    const map = root.querySelector('.fear-choice-map');
    const marker = root.querySelector('[data-fear-marker]');
    const why = root.querySelector('[data-fear-why]');
    const dialog = root.querySelector('[data-fear-dialog]');
    why.onclick = () => set({ context: 1 });
    root.querySelector('[data-fear-close]').onclick = () => set({ context: 0 });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) set({ context: 0 });
    });
    dialog.addEventListener('cancel', event => { event.preventDefault(); set({ context: 0 }); });
    dialog.addEventListener('close', () => { if (ctx.state.context === 1) set({ context: 0 }); why.focus({ preventScroll: true }); });
    root.querySelectorAll('[data-fear-choice]').forEach(button => {
      button.onclick = () => set({ choice: Number(button.dataset.fearChoice) });
    });
    root.querySelector('[data-fear-range]').oninput = event => set({ progress: Number(event.currentTarget.value) });
    root.querySelector('[data-fear-reset]').onclick = () => set({ progress: 0 });

    let drag = null;
    marker.addEventListener('pointerdown', event => {
      if (event.button !== 0 && event.pointerType !== 'touch') return;
      event.preventDefault();
      drag = { id: event.pointerId, x: event.clientX, progress: progressValue(ctx.state), travel: Math.max(1, map.getBoundingClientRect().width * .31) };
      marker.focus({ preventScroll: true });
      marker.setPointerCapture(event.pointerId);
      marker.classList.add('is-dragging');
    });
    marker.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.id) return;
      set({ progress: clamp(drag.progress + (event.clientX - drag.x) / drag.travel * 100, 0, 100) });
    });
    const finish = event => {
      if (!drag || event.pointerId !== drag.id) return;
      drag = null;
      marker.classList.remove('is-dragging');
      if (marker.hasPointerCapture(event.pointerId)) marker.releasePointerCapture(event.pointerId);
    };
    marker.addEventListener('pointerup', finish);
    marker.addEventListener('pointercancel', finish);
    marker.addEventListener('lostpointercapture', () => { drag = null; marker.classList.remove('is-dragging'); });
    marker.addEventListener('keydown', event => {
      let progress = progressValue(ctx.state);
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') progress += 5;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') progress -= 5;
      else if (event.key === 'Home') progress = 0;
      else if (event.key === 'End') progress = 100;
      else return;
      event.preventDefault(); event.stopPropagation(); set({ progress: clamp(progress, 0, 100) });
    });
  }

  function paint(ctx) {
    const { root, state, source } = ctx;
    const progress = progressValue(state), choice = choiceIndex(state), list = choices(source);
    const person = root.querySelector('[data-fear-person]');
    const fraction = progress / 100;
    const branch = Math.max(0, (fraction - 13 / 31) / (18 / 31));
    // Follow the same branch while keeping her feet on the meadow.
    person.style.setProperty('--person-progress', String(fraction));
    person.style.setProperty('--person-rise', `${([-10, -5.67, -1.33, 3][choice] * branch).toFixed(4)}%`);
    person.style.setProperty('--person-scale', String(1 - .3 * fraction));
    const x = 34 + progress * .31;
    const y = x <= 47 ? 50 : 50 + (destinationY(choice) - 50) * (x - 47) / 18;
    const marker = root.querySelector('[data-fear-marker]');
    marker.style.left = `${x}%`;
    marker.style.top = `${y}%`;
    marker.setAttribute('aria-valuenow', String(Math.round(progress)));
    marker.setAttribute('aria-valuetext', `${Math.round(progress)} percent toward ${list[choice]}. Fear remains.`);
    const activeRoute = root.querySelector('[data-fear-route]');
    activeRoute.setAttribute('d', x <= 47 ? `M 34 50 L ${x} 50` : `M 34 50 L 47 50 L ${x} ${y}`);
    const chamber = root.querySelector('[data-fear-chamber]');
    chamber.style.setProperty('--fear-progress', String(progress / 100));
    root.querySelectorAll('[data-fear-choice]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.fearChoice) === choice)));
    const range = root.querySelector('[data-fear-range]');
    range.value = String(progress);
    range.setAttribute('aria-label', `Progress toward ${list[choice]} while fear remains`);
    range.setAttribute('aria-valuetext', `${Math.round(progress)} percent. Fear remains.`);
    const context = state.context === 1, dialog = root.querySelector('[data-fear-dialog]');
    root.querySelector('[data-fear-why]').setAttribute('aria-expanded', String(context));
    if (context && !dialog.open) dialog.showModal();
    else if (!context && dialog.open) dialog.close();
  }

  registry[6] = { defaults: { progress: 0, choice: 0, context: 0 }, ranges: { progress: [0, 100], choice: [0, 3], context: [0, 1] }, render, bind, paint };
})();
