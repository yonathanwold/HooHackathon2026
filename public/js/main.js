/* global $ */

$(() => {
  const initTicker = () => {
    const track = document.getElementById('demoTicker');
    if (!track) return;
    const items = Array.from(track.querySelectorAll('.ticker-item'));
    if (!items.length) return;
    let idx = 0;
    items[idx].classList.add('active');
    setInterval(() => {
      items[idx].classList.remove('active');
      idx = (idx + 1) % items.length;
      items[idx].classList.add('active');
    }, 1800);
  };

  const initWalkthrough = () => {
    const steps = Array.from(document.querySelectorAll('.walk-step'));
    const dots = Array.from(document.querySelectorAll('.walk-dot'));
    const prev = document.getElementById('walkPrev');
    const next = document.getElementById('walkNext');
    if (!steps.length || !prev || !next) return;
    let idx = 0;
    const show = (i) => {
      steps.forEach((s) => s.classList.remove('active'));
      dots.forEach((d) => d.classList.remove('active'));
      steps[i].classList.add('active');
      if (dots[i]) dots[i].classList.add('active');
    };
    prev.addEventListener('click', () => {
      idx = (idx - 1 + steps.length) % steps.length;
      show(idx);
    });
    next.addEventListener('click', () => {
      idx = (idx + 1) % steps.length;
      show(idx);
    });
    dots.forEach((d) => {
      d.addEventListener('click', () => {
        const step = Number(d.dataset.step || 0);
        idx = step;
        show(idx);
      });
    });
    show(idx);
  };

  const initTacitus = () => {
    const app = document.getElementById('tacitusApp');
    if (!app) return;

    const sources = [
      { id: 1, name: 'Reuters Report, Mar 2025', rel: 'reliable' },
      { id: 2, name: 'Anonymous whistleblower', rel: 'contested' },
      { id: 3, name: 'Company press release', rel: 'unreliable' },
      { id: 4, name: 'Academic paper (Chen, 2024)', rel: 'reliable' },
    ];

    const claims = [
      {
        id: 1,
        text: 'The company knew about the vulnerability in Q3',
        stances: { 1: 'agrees', 3: 'disagrees' },
        note: 'Reuters cites internal emails. Company denies prior knowledge.',
      },
      {
        id: 2,
        text: 'Over 2 million users were affected',
        stances: { 1: 'agrees', 2: 'agrees', 3: 'disagrees' },
        note: 'Company claims 400,000 while Reuters and the whistleblower cite 2M+.',
      },
      {
        id: 3,
        text: 'A patch was available but not deployed',
        stances: { 4: 'agrees' },
        note: 'Only one source mentions this. Needs independent confirmation.',
      },
      {
        id: 4,
        text: 'Regulators were notified within 72 hours',
        stances: { 3: 'agrees' },
        note: 'Only company self-reports this. No independent confirmation yet.',
      },
      {
        id: 5,
        text: 'The vulnerability was a known CVE pattern',
        stances: { 1: 'agrees', 4: 'agrees' },
        note: 'Two independent sources confirm. Treat as established fact.',
      },
    ];

    let chat = [
      {
        role: 'bot',
        text: 'Ask me anything about your sources and claims. I will cite the claims by name and suggest next steps.',
      },
    ];

    const classifyClaim = (claim) => {
      const stances = Object.values(claim.stances || {});
      const agree = stances.filter((s) => s === 'agrees');
      const disagree = stances.filter((s) => s === 'disagrees');
      if (agree.length === 0 && disagree.length === 0) return 'unverified';
      if (agree.length > 0 && disagree.length > 0) return 'conflict';
      if (agree.length >= 2 && disagree.length === 0) return 'confirmed';
      if (agree.length === 1 && disagree.length === 0) return 'gap';
      return 'unverified';
    };

    const isUnreliableOnly = (claim) => {
      const agreeIds = Object.entries(claim.stances || {})
        .filter(([, stance]) => stance === 'agrees')
        .map(([id]) => Number(id));
      if (!agreeIds.length) return false;
      return agreeIds.every((id) => sources.find((s) => s.id === id)?.rel === 'unreliable');
    };

    const renderSources = () => {
      const list = document.getElementById('srcList');
      list.innerHTML = '';
      sources.forEach((s) => {
        const el = document.createElement('div');
        el.className = 'src-card';
        el.innerHTML = `
          <div>
            <div class="src-name">${s.name}</div>
            <div class="src-meta">Reliability</div>
          </div>
          <span class="tag ${s.rel}">${s.rel}</span>
        `;
        list.appendChild(el);
      });
      document.getElementById('srcCt').textContent = sources.length;
      renderContext();
    };

    const renderClaims = () => {
      const list = document.getElementById('claimList');
      list.innerHTML = '';
      claims.forEach((c) => {
        const type = classifyClaim(c);
        const redFlag = isUnreliableOnly(c);
        const el = document.createElement('div');
        el.className = 'claim-card';

        const tags = Object.entries(c.stances || {})
          .map(([id, stance]) => {
            const src = sources.find((s) => s.id === Number(id));
            if (!src) return '';
            return `<span class="stance ${stance}" data-claim="${c.id}" data-source="${src.id}">${src.name} - ${stance}</span>`;
          })
          .join('');

        const unattached = sources
          .filter((s) => !(c.stances || {})[s.id])
          .map(
            (s) =>
              `<button class="attach-btn" data-claim="${c.id}" data-source="${s.id}">+ ${s.name}</button>`,
          )
          .join('');

        const aiText = c.ai || 'No AI analysis yet. Run Ask AI for a 2-3 sentence investigative readout.';

        el.innerHTML = `
          <div class="claim-head">
            <div>
              <span class="badge ${type}">${type}</span>
              ${redFlag ? '<span class="badge redflag" style="margin-left:6px;">unreliable only</span>' : ''}
            </div>
            <div class="ai-actions">
              <button class="btn ghost" data-ask="${c.id}">Ask AI</button>
            </div>
          </div>
          <div class="claim-text">"${c.text}"</div>
          <div class="source-tags">${tags || '<span class="src-meta">No sources tagged yet.</span>'}</div>
          <div class="attach-row">${unattached || '<span class="src-meta">All sources attached.</span>'}</div>
          <div class="note">${c.note || 'Add a working note about evidence or open questions.'}</div>
          <div class="ai-box" id="ai-${c.id}">${aiText}</div>
        `;
        list.appendChild(el);
      });
      updateStats();
      renderThreads();
    };

    const updateStats = () => {
      document.getElementById('claimCt').textContent = claims.length;
      document.getElementById('confCt').textContent = claims.filter((c) => classifyClaim(c) === 'conflict').length;
      document.getElementById('gapCt').textContent = claims.filter((c) => classifyClaim(c) === 'gap').length;
      document.getElementById('confmCt').textContent = claims.filter((c) => classifyClaim(c) === 'confirmed').length;
    };

    const renderThreads = () => {
      const grid = document.getElementById('threadGrid');
      if (!grid) return;
      const buckets = [
        { title: 'Active conflicts to chase first', type: 'conflict' },
        { title: 'Gaps needing more sourcing', type: 'gap' },
        { title: 'Claims depending only on unreliable sources', type: 'redflag' },
        { title: 'Established confirmed facts', type: 'confirmed' },
        { title: 'Unverified claims with no sources yet', type: 'unverified' },
      ];
      grid.innerHTML = '';
      buckets.forEach((b) => {
        const block = document.createElement('div');
        block.className = 'thread-block';
        const items = claims.filter((c) => {
          const t = classifyClaim(c);
          if (b.type === 'redflag') return isUnreliableOnly(c);
          return t === b.type;
        });
        block.innerHTML = `<h3>${b.title}</h3>` +
          (items.length
            ? items
                .map(
                  (c) => `
            <div class="thread-item">
              <div class="thread-dot ${b.type === 'redflag' ? 'redflag' : classifyClaim(c)}"></div>
              <div>${c.text}</div>
            </div>
          `,
                )
                .join('')
            : '<div class="thread-item"><div class="thread-dot unverified"></div><div>Nothing here yet.</div></div>');
        grid.appendChild(block);
      });
    };

    const renderContext = () => {
      const list = document.getElementById('contextList');
      if (!list) return;
      list.innerHTML = '';
      sources.forEach((s) => {
        const row = document.createElement('label');
        row.className = 'context-item';
        row.innerHTML = `<input type="checkbox" checked data-context="${s.id}" /> ${s.name}`;
        list.appendChild(row);
      });
    };

    const addSource = () => {
      const name = document.getElementById('srcName').value.trim();
      const rel = document.getElementById('srcRel').value;
      if (!name) return;
      const id = Math.max(0, ...sources.map((s) => s.id)) + 1;
      sources.push({ id, name, rel });
      document.getElementById('srcName').value = '';
      renderSources();
      renderClaims();
    };

    const addClaim = () => {
      const text = document.getElementById('claimText').value.trim();
      if (!text) return;
      const id = Math.max(0, ...claims.map((c) => c.id)) + 1;
      claims.unshift({ id, text, stances: {}, note: 'New claim. Tag sources to classify this statement.' });
      document.getElementById('claimText').value = '';
      renderClaims();
    };

    const cycleStance = (claimId, sourceId) => {
      const claim = claims.find((c) => c.id === claimId);
      if (!claim) return;
      const current = claim.stances[sourceId] || 'untagged';
      const next = current === 'untagged' ? 'agrees' : current === 'agrees' ? 'disagrees' : 'untagged';
      if (next === 'untagged') delete claim.stances[sourceId];
      else claim.stances[sourceId] = next;
      renderClaims();
    };

    const attachSource = (claimId, sourceId) => {
      const claim = claims.find((c) => c.id === claimId);
      if (!claim) return;
      if (!claim.stances[sourceId]) claim.stances[sourceId] = 'agrees';
      renderClaims();
    };

    const runAskAI = (claimId) => {
      const claim = claims.find((c) => c.id === claimId);
      if (!claim) return;
      const type = classifyClaim(claim);
      const evidence = Object.entries(claim.stances)
        .map(([id, stance]) => {
          const src = sources.find((s) => s.id === Number(id));
          return `${src?.name || 'Unknown'} (${src?.rel || 'n/a'}) ${stance}`;
        })
        .join('; ');
      claim.ai =
        `Evidence readout: ${evidence || 'No sources attached.'} ` +
        `This claim is currently labeled ${type}. Next step: identify one independent source to verify or challenge the dominant stance.`;
      renderClaims();
    };

    const analyzeAll = () => {
      claims.forEach((c, idx) => {
        setTimeout(() => runAskAI(c.id), idx * 400);
      });
    };

    const sendAsk = () => {
      const input = document.getElementById('askInput');
      const text = input.value.trim();
      if (!text) return;
      chat.push({ role: 'user', text });
      const suggested = `Based on current claims, investigate "${claims[0]?.text || 'the leading conflict'}" next and cross-check with one reliable, independent source.`;
      chat.push({ role: 'bot', text: suggested });
      input.value = '';
      renderChat();
    };

    const renderChat = () => {
      const log = document.getElementById('chatLog');
      log.innerHTML = '';
      chat.forEach((m) => {
        const el = document.createElement('div');
        el.className = `chat-msg ${m.role}`;
        el.textContent = m.text;
        log.appendChild(el);
      });
      log.scrollTop = log.scrollHeight;
    };

    const bindEvents = () => {
      document.getElementById('addSrcBtn').addEventListener('click', addSource);
      document.getElementById('addClaimBtn').addEventListener('click', addClaim);
      document.getElementById('analyzeAll').addEventListener('click', analyzeAll);
      document.getElementById('askBtn').addEventListener('click', sendAsk);
      document.getElementById('askInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') sendAsk();
      });
      document.getElementById('srcName').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addSource();
      });
      document.getElementById('claimText').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addClaim();
      });
      document.querySelectorAll('.tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          const tab = btn.dataset.tab;
          document.getElementById('tab-claims').style.display = tab === 'claims' ? 'block' : 'none';
          document.getElementById('tab-threads').style.display = tab === 'threads' ? 'block' : 'none';
          document.getElementById('tab-ask').style.display = tab === 'ask' ? 'block' : 'none';
        });
      });

      document.addEventListener('click', (e) => {
        const stance = e.target.closest('.stance');
        if (stance) {
          const claimId = Number(stance.dataset.claim);
          const sourceId = Number(stance.dataset.source);
          cycleStance(claimId, sourceId);
        }
        const attach = e.target.closest('.attach-btn');
        if (attach) {
          const claimId = Number(attach.dataset.claim);
          const sourceId = Number(attach.dataset.source);
          attachSource(claimId, sourceId);
        }
        const ask = e.target.closest('[data-ask]');
        if (ask) {
          runAskAI(Number(ask.dataset.ask));
        }
        const hint = e.target.closest('.hint');
        if (hint) {
          document.getElementById('askInput').value = hint.dataset.hint;
          sendAsk();
        }
      });
    };

    renderSources();
    renderClaims();
    renderChat();
    bindEvents();
  };

  const initEventBuckets = () => {
    const buckets = document.querySelector('.event-buckets');
    if (!buckets) return;

    const conflictsList = document.getElementById('conflictsList');
    const releasesList = document.getElementById('releasesList');
    const cyberList = document.getElementById('cyberList');
    const politicsList = document.getElementById('politicsList');
    const businessList = document.getElementById('businessList');
    const scienceList = document.getElementById('scienceList');
    const regionSelect = document.getElementById('regionFilter');
    const timeframeSelect = document.getElementById('timeframeFilter');
    const categoryButtons = Array.from(document.querySelectorAll('.filter-pill'));

    const setLoading = (el, text) => {
      if (!el) return;
      el.innerHTML = `
        <div class="thread-item">
          <div class="thread-dot unverified"></div>
          <div>${text}</div>
        </div>
      `;
    };

    const escapeHtml = (value) =>
      String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const renderList = (el, items, dotClass, categoryValue, regionValue, timeframeValue, csrfToken) => {
      if (!el) return;
      if (!items.length) {
        el.innerHTML = `
          <div class="thread-item">
            <div class="thread-dot unverified"></div>
            <div>No updates found.</div>
          </div>
        `;
        return;
      }
      el.innerHTML = items
        .map((item) => {
          const source = item.sources && item.sources[0] ? item.sources[0] : null;
          const rawTitle = item.title || 'Untitled event';
          const decodedTitle = (() => {
            if (/%[0-9A-Fa-f]{2}/.test(rawTitle)) {
              try {
                return decodeURIComponent(rawTitle);
              } catch (err) {
                return rawTitle;
              }
            }
            return rawTitle;
          })();
          const safeTitle = escapeHtml(decodedTitle);
          const link = source ? `<a href="${source.uri}" target="_blank" rel="noreferrer">${safeTitle}</a>` : safeTitle;
          const form = `
            <form class="thread-add" method="POST" action="/events">
              <input type="hidden" name="_csrf" value="${csrfToken}">
              <input type="hidden" name="title" value="${escapeHtml(decodedTitle)}">
              <input type="hidden" name="category" value="${escapeHtml(categoryValue)}">
              <input type="hidden" name="region" value="${escapeHtml(regionValue)}">
              <input type="hidden" name="timeframe" value="${escapeHtml(timeframeValue)}">
              <button class="btn-ghost small btn-thread-add" type="submit">Add to Reality Desk</button>
            </form>
          `;
          return `
            <div class="thread-item">
              <div class="thread-left">
                <div class="thread-dot ${dotClass}"></div>
                <div>${link}</div>
              </div>
              ${form}
            </div>
          `;
        })
        .join('');
    };

    const load = async () => {
      const activeBtn = categoryButtons.find((b) => b.classList.contains('is-active'));
      const category = activeBtn ? activeBtn.dataset.category : 'all';
      const region = regionSelect ? regionSelect.value : 'all';
      const timeframe = timeframeSelect ? timeframeSelect.value : '7d';
      const regionForEvent = region === 'all' ? 'global' : region;
      const timeframeMap = {
        '24h': 'last 24 hours',
        '7d': 'last 7 days',
        '30d': 'last 30 days',
      };
      const timeframeForEvent = timeframeMap[timeframe] || 'last 7 days';
      const csrfTokenEl = document.querySelector('meta[name="csrf-token"]');
      const csrfToken = csrfTokenEl ? csrfTokenEl.content : '';

      setLoading(conflictsList, 'Loading conflicts...');
      setLoading(releasesList, 'Loading releases...');
      setLoading(cyberList, 'Loading cyber events...');
      setLoading(politicsList, 'Loading political events...');
      setLoading(businessList, 'Loading business events...');
      setLoading(scienceList, 'Loading science events...');

      const safeJson = async (res) => {
        try {
          return await res.json();
        } catch (err) {
          const text = await res.text();
          return { ok: false, error: text || 'Invalid JSON response.' };
        }
      };

      try {
        const params = new URLSearchParams({ category, region, timeframe });
        const res = await fetch(`/events/buckets?${params.toString()}`);
        const payload = await safeJson(res);
        if (!payload.ok) throw new Error(payload.error || 'Failed to load');
        renderList(conflictsList, payload.data.conflicts || [], 'conflict', 'conflict', regionForEvent, timeframeForEvent, csrfToken);
        renderList(releasesList, payload.data.releases || [], 'gap', 'release', regionForEvent, timeframeForEvent, csrfToken);
        renderList(cyberList, payload.data.cyber || [], 'redflag', 'cyber', regionForEvent, timeframeForEvent, csrfToken);
        renderList(politicsList, payload.data.politics || [], 'policy', 'politics', regionForEvent, timeframeForEvent, csrfToken);
        renderList(businessList, payload.data.business || [], 'business', 'business', regionForEvent, timeframeForEvent, csrfToken);
        renderList(scienceList, payload.data.science || [], 'science', 'science', regionForEvent, timeframeForEvent, csrfToken);
      } catch (err) {
        setLoading(conflictsList, 'Unable to load conflicts.');
        setLoading(releasesList, 'Unable to load releases.');
        setLoading(cyberList, 'Unable to load cyber events.');
        setLoading(politicsList, 'Unable to load political events.');
        setLoading(businessList, 'Unable to load business events.');
        setLoading(scienceList, 'Unable to load science events.');
      }
    };

    categoryButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        categoryButtons.forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        load();
      });
    });
    if (regionSelect) regionSelect.addEventListener('change', load);
    if (timeframeSelect) timeframeSelect.addEventListener('change', load);
    load();
  };

  const initAskInterface = () => {
    const askPane = document.querySelector('.ask-pane');
    if (!askPane) return;

    const log = askPane.querySelector('#askLog');
    const input = askPane.querySelector('#askInput');
    const button = askPane.querySelector('#askBtn');
    const hintButtons = Array.from(askPane.querySelectorAll('.hint[data-hint]'));
    const csrfTokenEl = document.querySelector('meta[name="csrf-token"]');
    const csrfToken = csrfTokenEl ? csrfTokenEl.content : '';

    if (!log || !input || !button) return;

    const appendMessage = (role, text) => {
      const el = document.createElement('div');
      el.className = `chat-msg ${role}`;
      el.textContent = text;
      log.appendChild(el);
      log.scrollTop = log.scrollHeight;
      return el;
    };

    const setLoading = (isLoading) => {
      button.disabled = isLoading;
      button.textContent = isLoading ? 'Sending...' : 'Submit';
    };

    const sendAsk = async () => {
      const prompt = input.value.trim();
      if (!prompt) return;
      input.value = '';
      appendMessage('user', prompt);
      const placeholder = appendMessage('bot', 'Thinking...');
      setLoading(true);
      const safeJson = async (res) => {
        try {
          return await res.json();
        } catch (err) {
          const text = await res.text();
          return { ok: false, error: text || 'Invalid JSON response.' };
        }
      };

      try {
        const res = await fetch('/api/ask', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          body: JSON.stringify({ prompt }),
        });
        const payload = await safeJson(res);
        if (!payload.ok) throw new Error(payload.error || 'Unable to answer right now.');
        placeholder.textContent = payload.reply;
      } catch (err) {
        placeholder.textContent = err.message || 'Unable to answer right now.';
      } finally {
        setLoading(false);
      }
    };

    button.addEventListener('click', sendAsk);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendAsk();
    });
    hintButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        input.value = btn.dataset.hint || '';
        sendAsk();
      });
    });
  };

  const initEventTabs = () => {
    const tabButtons = Array.from(document.querySelectorAll('.event-tabs .tab-btn'));
    if (!tabButtons.length) return;
    const openTab = document.getElementById('tab-open');
    const archiveTab = document.getElementById('tab-archive');
    if (!openTab || !archiveTab) return;

    const setActive = (target) => {
      tabButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === target));
      openTab.style.display = target === 'open' ? 'block' : 'none';
      archiveTab.style.display = target === 'archive' ? 'block' : 'none';
    };

    tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        setActive(btn.dataset.tab);
      });
    });
  };

  initTicker();
  initWalkthrough();
  initTacitus();
  initEventBuckets();
  initAskInterface();
  initEventTabs();
});
