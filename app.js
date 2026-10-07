(() => {
    'use strict';

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const $ = (sel) => document.querySelector(sel);

    // ===== База знаний студии «Лотос» =====
    const OPEN = 10;
    const LAST = 20; // последний час начала записи
    const SERVICES = {
        cutW: { name: 'Женская стрижка', price: '2 500 ₽' },
        cutM: { name: 'Мужская стрижка', price: '1 800 ₽' },
        nails: { name: 'Маникюр', price: '2 000 ₽' },
        color: { name: 'Окрашивание', price: 'от 5 500 ₽' },
        massage: { name: 'Массаж спины', price: '3 000 ₽' }
    };
    const ADDRESS = 'Мы на Покровке, 12, второй этаж. Пять минут от метро «Чистые пруды», во дворе есть парковка.';
    const HOURS = `Работаем ежедневно с ${OPEN}:00 до ${LAST + 1}:00.`;

    const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    const WEEKDAYS = [
        ['воскресен', 0], ['понедельник', 1], ['вторник', 2], ['сред', 3],
        ['четверг', 4], ['пятниц', 5], ['суббот', 6]
    ];
    const DAY_PARTS = [
        { re: /утр/, from: 10, to: 12 },
        { re: /после обеда|днем|днём/, from: 13, to: 16 },
        { re: /вечер/, from: 17, to: 20 }
    ];

    // ===== Состояние =====
    let slots, step, bookings, thinking, lastBooked, showBooked;
    let gen = 0;

    function resetState() {
        slots = { service: null, date: null, time: null, name: null };
        step = 'idle';
        bookings = [];
        thinking = false;
        lastBooked = null;
        showBooked = false;
    }

    // ===== Даты и расписание =====
    const pad = (n) => String(n).padStart(2, '0');
    const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
    const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
    const today = () => startOfDay(new Date());

    function label(d) {
        const diff = Math.round((startOfDay(d) - today()) / 86400000);
        if (diff === 0) return 'сегодня';
        if (diff === 1) return 'завтра';
        return d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
    }

    // «на сегодня», «на завтра», «на пятницу, 9 октября»
    function na(d) {
        const l = label(d);
        if (l === 'сегодня' || l === 'завтра') return `на ${l}`;
        return `на ${l.replace(/^(сред|пятниц|суббот)а/, '$1у')}`;
    }

    // «Занятые» часы задаются детерминированно от даты, чтобы демо выглядело живым и повторялось
    function seededBusy(d) {
        const k = key(d);
        let h = 0;
        for (const ch of k) h = (h * 31 + ch.charCodeAt(0)) % 997;
        const busy = new Set();
        for (let hour = OPEN; hour <= LAST; hour++) {
            if ((h + hour * 7) % 5 === 0) busy.add(hour);
        }
        return busy;
    }

    function isBusy(d, hour) {
        if (seededBusy(d).has(hour)) return true;
        if (bookings.some((b) => key(b.date) === key(d) && b.time === hour)) return true;
        const now = new Date();
        return key(d) === key(now) && hour <= now.getHours();
    }

    function freeHours(d) {
        const out = [];
        for (let h = OPEN; h <= LAST; h++) if (!isBusy(d, h)) out.push(h);
        return out;
    }

    const hh = (h) => `${pad(h)}:00`;

    // ===== Разбор фразы клиента =====
    const norm = (t) => t.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

    function parseService(t) {
        if (/стриж|подстричь|причес/.test(t)) return /муж|парн|барбер/.test(t) ? 'cutM' : 'cutW';
        if (/маник|ногт|гель|педик/.test(t)) return 'nails';
        if (/окраш|краск|колор|блонд|мелиров|покраси/.test(t)) return 'color';
        if (/массаж|спин/.test(t)) return 'massage';
        return null;
    }

    function parseDate(t) {
        const base = today();
        let m;
        if (/послезавтра/.test(t)) return { date: addDays(base, 2), rest: t.replace('послезавтра', ' ') };
        if (/завтра/.test(t)) return { date: addDays(base, 1), rest: t.replace('завтра', ' ') };
        if (/сегодня/.test(t)) return { date: base, rest: t.replace('сегодня', ' ') };

        m = t.match(new RegExp(`\\b(\\d{1,2})\\s+(${MONTHS.join('|')})`));
        if (m) {
            const d = new Date(base.getFullYear(), MONTHS.indexOf(m[2]), Number(m[1]));
            if (d < base) d.setFullYear(d.getFullYear() + 1);
            return { date: d, rest: t.replace(m[0], ' ') };
        }

        for (const [stem, dow] of WEEKDAYS) {
            const wm = t.match(new RegExp(`(?:^|[^а-я])${stem}[а-я]*`));
            if (wm) {
                let diff = (dow - base.getDay() + 7) % 7;
                if (diff === 0) diff = 7;
                return { date: addDays(base, diff), rest: t.replace(wm[0], ' ') };
            }
        }
        return null;
    }

    function parseTime(t) {
        let m = t.match(/\b(\d{1,2}):(\d{2})\b/);
        if (m) return { hour: Number(m[1]), minutes: Number(m[2]) };
        m = t.match(/(?:^|[^а-я])в\s+(\d{1,2})(?!\d)(?!\s*(?:мин|числ))/) || t.match(/(?:^|\D)(\d{1,2})\s*(?:час|ч(?![а-я]))/);
        if (m) return { hour: Number(m[1]), minutes: 0 };
        if (step === 'time') {
            m = t.match(/^\D{0,6}(\d{1,2})\D{0,6}$/);
            if (m) return { hour: Number(m[1]), minutes: 0 };
        }
        return null;
    }

    function parseName(raw) {
        const m = raw.match(/(?:меня зовут|мо[её] имя|зовите меня|это)\s+([А-Яа-яЁёA-Za-z-]{2,20})/i);
        let word = m ? m[1] : null;
        if (!word && step === 'name') {
            const first = raw.trim().split(/\s+/)[0].replace(/[.,!?]/g, '');
            if (/^[А-Яа-яЁёA-Za-z-]{2,20}$/.test(first)) word = first;
        }
        return word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : null;
    }

    // ===== Вывод в интерфейс =====
    const messagesEl = $('#messages');
    const chipsEl = $('#chips');
    const inputEl = $('#input');
    const sendEl = $('#send');

    function addBubble(text, who) {
        const b = document.createElement('div');
        b.className = `bubble ${who}`;
        b.textContent = text;
        const time = document.createElement('time');
        time.textContent = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        b.appendChild(time);
        messagesEl.appendChild(b);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function setChips(list) {
        chipsEl.textContent = '';
        list.forEach((text) => {
            const c = document.createElement('button');
            c.type = 'button';
            c.className = 'chip';
            c.textContent = text;
            c.addEventListener('click', () => handleUser(text));
            chipsEl.appendChild(c);
        });
    }

    function setInfo(intent, source) {
        $('#intent').textContent = intent;
        $('#source').textContent = source;
    }

    function renderSlots() {
        const src = showBooked && lastBooked ? lastBooked : slots;
        const vals = {
            service: src.service ? SERVICES[src.service].name : '—',
            date: src.date ? label(src.date) : '—',
            time: src.time !== null ? hh(src.time) : '—',
            name: src.name || '—'
        };
        document.querySelectorAll('#slots li').forEach((li) => {
            const k = li.dataset.slot;
            li.querySelector('b').textContent = vals[k];
            li.classList.toggle('filled', vals[k] !== '—');
        });
    }

    function renderSchedule() {
        const d = slots.date || (lastBooked ? lastBooked.date : today());
        $('#sched-date').textContent = label(d);
        const grid = $('#sched');
        grid.textContent = '';
        for (let h = OPEN; h <= LAST; h++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.textContent = hh(h);
            const mine = bookings.some((b) => key(b.date) === key(d) && b.time === h);
            if (mine) cell.classList.add('mine');
            else if (isBusy(d, h)) cell.classList.add('busy');
            if (slots.date && slots.time === h && !mine) cell.classList.add('pick');
            grid.appendChild(cell);
        }
    }

    function renderJournal() {
        const list = $('#journal');
        list.textContent = '';
        if (!bookings.length && !handoffs.length) {
            const li = document.createElement('li');
            li.className = 'empty';
            li.textContent = 'Пока пусто. Запишитесь через чат.';
            list.appendChild(li);
            return;
        }
        [...handoffs, ...bookings].sort((a, b) => b.id - a.id).forEach((item) => {
            const li = document.createElement('li');
            const b = document.createElement('b');
            const small = document.createElement('small');
            if (item.handoff) {
                li.className = 'handoff';
                b.textContent = 'Диалог передан администратору';
                small.textContent = 'Сводка отправлена Марии · ответ в течение 15 минут';
            } else {
                b.textContent = `${item.name} · ${SERVICES[item.service].name}`;
                small.textContent = `${label(item.date)}, ${hh(item.time)} → мастеру ушло уведомление`;
            }
            li.append(b, small);
            list.appendChild(li);
        });
    }

    let handoffs = [];
    let seq = 0;

    function renderAll() {
        renderSlots();
        renderSchedule();
        renderJournal();
    }

    // ===== Логика ответов =====
    function bookingPrompt(notes) {
        const pre = notes.length ? notes.join(' ') + ' ' : '';
        if (!slots.service) {
            step = 'service';
            return { text: pre + 'На какую услугу записать?', chips: Object.values(SERVICES).map((s) => s.name) };
        }
        if (!slots.date) {
            step = 'date';
            const base = today();
            return { text: pre + 'На какой день?', chips: ['Сегодня', 'Завтра', label(addDays(base, 2)), label(addDays(base, 3))] };
        }
        if (slots.time === null) {
            const free = freeHours(slots.date);
            if (!free.length) {
                const d = slots.date;
                slots.date = null;
                step = 'date';
                return { text: `${pre}${na(d)[0].toUpperCase() + na(d).slice(1)} свободных окон уже нет. Попробуем другой день?`, chips: ['Завтра', label(addDays(today(), 2))] };
            }
            step = 'time';
            return { text: `${pre}${na(slots.date)[0].toUpperCase() + na(slots.date).slice(1)} свободно: ${free.map(hh).join(', ')}. Какое время удобно?`, chips: free.slice(0, 6).map(hh) };
        }
        if (!slots.name) {
            step = 'name';
            return { text: pre + 'Как вас зовут?', chips: [] };
        }
        step = 'confirm';
        return {
            text: `${pre}Проверяю: ${SERVICES[slots.service].name}, ${label(slots.date)}, ${hh(slots.time)}, имя — ${slots.name}. Всё верно?`,
            chips: ['Да, подтверждаю', 'Изменить время']
        };
    }

    function confirmBooking() {
        const booking = { id: ++seq, name: slots.name, service: slots.service, date: slots.date, time: slots.time };
        bookings.push(booking);
        lastBooked = booking;
        showBooked = true;
        const text = `Готово, ${booking.name}! Записала: ${SERVICES[booking.service].name}, ${label(booking.date)}, ${hh(booking.time)}. Напомню за два часа. Мастеру уже отправила уведомление.`;
        slots = { service: null, date: null, time: null, name: null };
        step = 'idle';
        return { text, chips: ['Записаться ещё', 'Где вы находитесь?'], intent: 'Запись подтверждена', source: 'Календарь студии' };
    }

    const FAQ_RULES = [
        { re: /^(привет|здравств|добрый|доброе|добрая|хай|hello|hi\b)/, intent: 'Приветствие', source: 'Сценарий приветствия',
          reply: () => ({ text: 'Здравствуйте! Я Сова, помогу записаться и отвечу на вопросы. Что нужно?', chips: ['Записаться на стрижку', 'Сколько стоит маникюр?', 'Где вы находитесь?'] }) },
        { re: /спасибо|благодар/, intent: 'Благодарность', source: 'Сценарий вежливости',
          reply: () => ({ text: 'Пожалуйста! Пишите в любое время, я на связи.', chips: [] }) },
        { re: /адрес|где (вы )?(наход|располож)|как добрат|проехать|парковк/, intent: 'Вопрос об адресе', source: 'База знаний: контакты',
          reply: () => ({ text: ADDRESS, chips: ['Записаться на стрижку'] }) },
        { re: /график|до скольки|часы работы|работаете|во сколько (откр|закр)/, intent: 'Вопрос о графике', source: 'База знаний: контакты',
          reply: () => ({ text: HOURS, chips: ['Записаться на стрижку'] }) },
        { re: /сколько|цен|стоим|стоит|прайс/, intent: 'Вопрос о цене', source: 'База знаний: прайс',
          reply: (t) => {
              const svc = parseService(t);
              if (svc) return { text: `${SERVICES[svc].name} — ${SERVICES[svc].price}. Хотите, подберу время?`, chips: [`Записать на ${SERVICES[svc].name.toLowerCase()}`] };
              return { text: Object.values(SERVICES).map((s) => `${s.name} — ${s.price}`).join('\n'), chips: ['Записаться на маникюр'] };
          } }
    ];

    const HUMAN_RE = /жалоб|ужас|плох|недовол|верните|возврат|обман|администратор|человек|оператор|менеджер|директор/;
    const CANCEL_RE = /отмен|не приду|не смогу прийти|удали запись/;
    const BOOK_RE = /запиш|записат|запись|окошк|окно|свободн|хочу на|хотела бы|хотел бы|можно на/;
    const YES_RE = /(?:^|[^а-я])(?:да|ок|окей|верно|давайте|правильно|все так)(?![а-я])|подтвержда/;
    const NO_RE = /(?:^|[^а-я])нет(?![а-я])|не так|измен|друг|поменя/;

    function answer(raw) {
        const t = norm(raw);
        showBooked = false;

        // Отмена последней записи
        if (CANCEL_RE.test(t)) {
            const last = bookings.pop();
            step = 'idle';
            slots = { service: null, date: null, time: null, name: null };
            if (!last) return { text: 'Активных записей не нашла. Если нужна помощь, скажите, что случилось.', chips: [], intent: 'Отмена записи', source: 'Календарь студии' };
            lastBooked = last;
            return { text: `Отменила: ${SERVICES[last.service].name}, ${label(last.date)}, ${hh(last.time)}. Окно снова свободно. Записать на другое время?`, chips: ['Записаться ещё'], intent: 'Отмена записи', source: 'Календарь студии' };
        }

        // Жалобы и просьба позвать человека
        if (HUMAN_RE.test(t)) {
            handoffs.push({ id: ++seq, handoff: true });
            step = 'idle';
            return { text: 'Мне жаль, что так вышло. Такие вопросы решает человек, поэтому передаю диалог администратору Марии. Она ответит в течение 15 минут и увидит всё, что вы написали.', chips: [], intent: 'Жалоба → человек', source: 'Правила передачи администратору' };
        }

        // В подтверждении: да / нет
        if (step === 'confirm') {
            if (YES_RE.test(t) && !NO_RE.test(t)) return confirmBooking();
            if (NO_RE.test(t) && !parseDate(t) && !parseTime(t)) {
                slots.time = null;
                const r = bookingPrompt(['Хорошо, поменяем.']);
                return { ...r, intent: 'Запись на услугу', source: 'Календарь студии' };
            }
        }

        // Вопросы по базе знаний (если фраза не заполняет запись)
        const dateHit = parseDate(t);
        const faq = FAQ_RULES.find((r) => r.re.test(t));
        const looksLikeBooking = BOOK_RE.test(t) || (dateHit && parseService(t));
        if (faq && !looksLikeBooking && !(step === 'name' && faq.intent === 'Приветствие')) {
            const r = faq.reply(t);
            return { ...r, intent: faq.intent, source: faq.source };
        }

        // Запись: вытаскиваем всё, что получится
        const notes = [];
        const svc = parseService(t);
        if (svc) slots.service = svc;

        let rest = t;
        if (dateHit) {
            const limit = addDays(today(), 13);
            if (dateHit.date > limit) {
                notes.push('Записываю на ближайшие две недели.');
            } else {
                if (!slots.date || key(slots.date) !== key(dateHit.date)) slots.time = null;
                slots.date = dateHit.date;
            }
            rest = dateHit.rest;
        }

        const partHit = DAY_PARTS.find((p) => p.re.test(t));
        const timeHit = parseTime(rest);
        if (timeHit) {
            if (timeHit.hour < OPEN || timeHit.hour > LAST) {
                notes.push(`Записываю на время с ${OPEN}:00 до ${LAST}:00, выберите его из этого промежутка.`);
            } else if (slots.date && isBusy(slots.date, timeHit.hour)) {
                notes.push(`В ${hh(timeHit.hour)} уже занято.`);
                slots.time = null;
            } else {
                if (timeHit.minutes) notes.push(`Окна начинаются в начале часа, поставила на ${hh(timeHit.hour)}.`);
                slots.time = timeHit.hour;
            }
        } else if (partHit && slots.date && slots.service) {
            const free = freeHours(slots.date).filter((h) => h >= partHit.from && h <= partHit.to);
            if (free.length) {
                step = 'time';
                return { text: `Из подходящего свободно: ${free.map(hh).join(', ')}. Какое выбираете?`, chips: free.map(hh), intent: 'Запись на услугу', source: 'Календарь студии' };
            }
            notes.push('В это время всё занято.');
        }

        const name = parseName(raw);
        if (name) slots.name = name;

        const progressed = svc || dateHit || timeHit || name || partHit;
        if (!progressed && step === 'idle' && !BOOK_RE.test(t)) {
            return {
                text: 'Кажется, я не совсем поняла. Могу записать на услугу, назвать цены, подсказать адрес или позвать администратора.',
                chips: ['Записаться на стрижку', 'Сколько стоит маникюр?', 'Позвать администратора'],
                intent: 'Не распознано', source: '—'
            };
        }
        if (!progressed && step !== 'idle' && step !== 'confirm') notes.push('Не уловила, давайте ещё раз.');

        const r = bookingPrompt(notes);
        return { ...r, intent: 'Запись на услугу', source: 'Календарь студии' };
    }

    // ===== Диалог =====
    function handleUser(raw) {
        const text = raw.trim();
        if (!text || thinking) return;
        addBubble(text, 'user');
        inputEl.value = '';
        setChips([]);
        thinking = true;
        inputEl.disabled = true;
        sendEl.disabled = true;

        const typing = document.createElement('div');
        typing.className = 'bubble bot typing';
        typing.innerHTML = '<span></span><span></span><span></span>';
        messagesEl.appendChild(typing);
        messagesEl.scrollTop = messagesEl.scrollHeight;

        const result = answer(text);
        const myGen = gen;

        setTimeout(() => {
            if (myGen !== gen) return;
            typing.remove();
            addBubble(result.text, 'bot');
            setChips(result.chips || []);
            setInfo(result.intent || 'Запись на услугу', result.source || 'Календарь студии');
            renderAll();
            thinking = false;
            inputEl.disabled = false;
            sendEl.disabled = false;
            if (!window.matchMedia('(pointer: coarse)').matches) inputEl.focus();
        }, reduceMotion ? 0 : 650);
    }

    function start() {
        gen++;
        resetState();
        handoffs = [];
        messagesEl.textContent = '';
        inputEl.disabled = false;
        sendEl.disabled = false;
        addBubble('Здравствуйте! Я Сова, администратор студии «Лотос». Отвечаю в любое время, даже ночью. Чем помочь?', 'bot');
        setChips(['Записаться на стрижку', 'Сколько стоит маникюр?', 'Где вы находитесь?', 'Хочу пожаловаться']);
        setInfo('Ждёт сообщение', '—');
        renderAll();
    }

    $('#composer').addEventListener('submit', (e) => {
        e.preventDefault();
        handleUser(inputEl.value);
    });
    $('#reset').addEventListener('click', start);

    // ===== Калькулятор =====
    const PLAN_PRICE = 29900;
    const PLAN_MONTHLY = 3900;
    const RECOVER = 0.7; // допущение: Сова удерживает 70% «уходящих»
    const fmt = (n) => Math.round(n).toLocaleString('ru-RU');

    function calc() {
        const msgs = Number($('#in-msgs').value);
        const share = Number($('#in-share').value) / 100;
        const check = Number($('#in-check').value);

        $('#o-msgs').textContent = msgs;
        $('#o-share').textContent = `${Math.round(share * 100)}%`;
        $('#o-check').textContent = `${fmt(check)} ₽`;

        const lostN = msgs * 4.3 * share;
        const lostSum = lostN * check;
        const back = lostSum * RECOVER;
        const net = back - PLAN_MONTHLY;

        $('#r-lost').textContent = `${fmt(lostSum)} ₽`;
        $('#r-lost-n').textContent = `около ${Math.round(lostN)} записей в месяц`;
        $('#r-back').textContent = `${fmt(back)} ₽/мес`;

        const note = $('#r-note');
        if (net <= 0) {
            $('#r-payback').textContent = 'не окупится';
            note.textContent = 'При таких вводных пакет «Салон» не окупится, и тогда он вам не нужен. Начните с пакета «Старт».';
        } else {
            const months = PLAN_PRICE / net;
            $('#r-payback').textContent = months < 1 ? 'меньше месяца' : `${months.toFixed(1).replace('.', ',')} мес.`;
            note.textContent = `Расчёт для пакета «Салон»: ${fmt(PLAN_PRICE)} ₽ разово и ${fmt(PLAN_MONTHLY)} ₽ в месяц. Допущение: Сова удержит около ${Math.round(RECOVER * 100)}% уходящих клиентов, у вас цифра может отличаться.`;
        }
    }

    ['#in-msgs', '#in-share', '#in-check'].forEach((id) => $(id).addEventListener('input', calc));

    // ===== Шапка: тень при прокрутке =====
    const nav = $('#nav');
    const onScroll = () => { nav.style.boxShadow = window.scrollY > 10 ? '0 6px 30px rgba(0,0,0,0.4)' : 'none'; };
    window.addEventListener('scroll', onScroll, { passive: true });

    start();
    calc();
})();
