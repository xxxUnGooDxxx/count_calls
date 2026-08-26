import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { getFirestore, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import firebaseConfig from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const format = new Intl.NumberFormat('ru-RU');
const categoryNames = { spam: 'Спам', collector: 'Коллекторы', robot: 'Роботы', fraud: 'Мошенники' };
let stats;

function localDay(offset = 0) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Irkutsk' }).format(new Date(Date.now() + offset * 86400000));
}

function lineChart(element, values, captions, color = '#5ee29c') {
  if (!values.some(Boolean)) {
    element.innerHTML = '<div class="empty">За этот период жалоб нет</div>';
    return;
  }
  const width = 800, height = 250, left = 35, bottom = 28, top = 10;
  const plotWidth = width - left - 8, plotHeight = height - bottom - top;
  const max = Math.max(...values, 1);
  const x = (index) => left + (values.length === 1 ? plotWidth / 2 : index * plotWidth / (values.length - 1));
  const y = (value) => top + plotHeight - value / max * plotHeight;
  const points = values.map((value, index) => `${x(index)},${y(value)}`).join(' ');
  const grid = [0, .25, .5, .75, 1].map((part) => `<line x1="${left}" y1="${top + plotHeight * part}" x2="${width}" y2="${top + plotHeight * part}" stroke="#273530"/><text class="axis" x="0" y="${top + plotHeight * part + 4}">${Math.round(max * (1 - part))}</text>`).join('');
  const step = Math.max(1, Math.ceil(values.length / 7));
  const labels = captions.map((caption, index) => index % step === 0 || index === captions.length - 1 ? `<text class="axis" x="${x(index)}" y="${height - 4}" text-anchor="middle">${caption}</text>` : '').join('');
  const dots = values.map((value, index) => `<circle cx="${x(index)}" cy="${y(value)}" r="3" fill="${color}"><title>${captions[index]}: ${value}</title></circle>`).join('');
  element.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${grid}<polyline fill="none" stroke="${color}" stroke-width="3" vector-effect="non-scaling-stroke" points="${points}"/>${dots}${labels}</svg>`;
}

function renderTrend(days) {
  const keys = Array.from({ length: days }, (_, index) => localDay(index - days + 1));
  const captions = keys.map((key) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${key}T12:00:00Z`)));
  lineChart(document.querySelector('#trend'), keys.map((key) => stats.daily[key] || 0), captions);
}

function render(data) {
  stats = data;
  const today = data.daily[localDay()] || 0;
  const yesterday = data.daily[localDay(-1)] || 0;
  const delta = today - yesterday;
  document.querySelector('#today').textContent = format.format(today);
  document.querySelector('#delta').textContent = `${delta >= 0 ? '+' : ''}${format.format(delta)} ко вчерашнему дню`;
  document.querySelector('#reports').textContent = format.format(data.totals.reports);
  document.querySelector('#numbers').textContent = format.format(data.totals.uniqueNumbers);
  document.querySelector('#danger').textContent = format.format(data.totals.hasComplaints);
  document.querySelector('#danger-share').textContent = `${data.totals.uniqueNumbers ? (data.totals.hasComplaints / data.totals.uniqueNumbers * 100).toFixed(1) : 0}% имеют 5+ жалоб`;
  const generated = data.generatedAt?.toDate ? data.generatedAt.toDate() : new Date();
  document.querySelector('#updated').textContent = `обновлено ${new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: data.timeZone }).format(generated)}`;

  const dist = data.complaintDistribution;
  const items = [['1 жалоба', dist['1']], ['2 жалобы', dist['2']], ['3 жалобы', dist['3']], ['4 жалобы', dist['4']], ['5 жалоб', dist['5']], ['Более 5', dist.moreThan5]];
  const max = Math.max(...items.map((item) => item[1]), 1);
  document.querySelector('#distribution').innerHTML = items.map(([label, value]) => `<div class="bar"><span>${label}</span><div class="track"><div class="fill" style="width:${value / max * 100}%"></div></div><span class="value">${format.format(value)}</span></div>`).join('');
  document.querySelector('#categories').innerHTML = Object.entries(data.categories).map(([key, value]) => `<div class="category"><span>${categoryNames[key] || key}</span><strong>${format.format(value)}</strong></div>`).join('');
  lineChart(document.querySelector('#hourly'), data.hourlyToday, data.hourlyToday.map((_, hour) => `${String(hour).padStart(2, '0')}:00`), '#ffbd59');
  renderTrend(7);
  if (data.reportsWithoutDate) {
    const warning = document.querySelector('#warning');
    warning.hidden = false;
    warning.textContent = `У ${format.format(data.reportsWithoutDate)} записей не распознана дата: они входят в общий итог, но не в динамику.`;
  }
}

document.querySelector('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = document.querySelector('#login-error');
  error.textContent = '';
  try {
    await signInWithEmailAndPassword(auth, document.querySelector('#email').value, document.querySelector('#password').value);
  } catch {
    error.textContent = 'Не удалось войти. Проверьте email и пароль.';
  }
});
document.querySelector('#logout').addEventListener('click', () => signOut(auth));
document.querySelectorAll('[data-days]').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('[data-days]').forEach((item) => item.classList.toggle('active', item === button));
  renderTrend(Number(button.dataset.days));
}));

onAuthStateChanged(auth, async (user) => {
  document.querySelector('#login').hidden = Boolean(user);
  document.querySelector('#dashboard').hidden = !user;
  if (!user) return;
  try {
    const snapshot = await getDoc(doc(db, 'dashboard_stats', 'current'));
    if (!snapshot.exists()) throw new Error('missing');
    render(snapshot.data());
  } catch {
    document.querySelector('#updated').textContent = 'Статистика пока недоступна';
  }
});
