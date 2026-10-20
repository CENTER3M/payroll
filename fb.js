// Firebase backend for the payroll app: login, roles, Firestore adapter, downloads, install
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail, updateProfile } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, doc, collection, query, where, getDoc, getDocs, setDoc, deleteDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

window.__fbLoaded = true;
const firebaseConfig = {
  apiKey: "AIzaSyBHLQ3Qmwe8j_AaLjxaGqzKGS0a2R-XJbs",
  authDomain: "payrol-1847d.firebaseapp.com",
  projectId: "payrol-1847d",
  storageBucket: "payrol-1847d.firebasestorage.app",
  messagingSenderId: "162815503558",
  appId: "1:162815503558:web:1238973765bddab360fbc7"
};
// صاحب البرنامج: لازم يكون نفس الإيميل المكتوب في قواعد الأمان (firestore.rules)
const OWNER_EMAIL = "mohamedtahoun363@gmail.com";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const fs = initializeFirestore(app, { ignoreUndefinedProperties: true });
const clone = o => JSON.parse(JSON.stringify(o ?? {}));
const err = e => ({ code: e && e.code === "permission-denied" ? "invalid_argument" : "unavailable", message: e?.message || String(e) });

/* ---------- db adapter: same calls the page already makes ---------- */
const wrapDoc = s => ({ id: s.id, exists: s.exists(), data: () => (s.exists() ? s.data() : undefined) });
const wrapQuery = s => ({ docs: s.docs.map(wrapDoc), size: s.size, empty: s.empty });
function docRef(path) {
  const r = doc(fs, path);
  return {
    id: r.id, path,
    get: async () => { try { return wrapDoc(await getDoc(r)); } catch (e) { throw err(e); } },
    set: async d => { try { await setDoc(r, clone(d)); } catch (e) { throw err(e); } },
    update: async d => { try { await setDoc(r, clone(d), { merge: true }); } catch (e) { throw err(e); } },
    delete: async () => { try { await deleteDoc(r); } catch (e) { throw err(e); } },
    onSnapshot: (next, onErr) => onSnapshot(r, s => next(wrapDoc(s)), e => onErr && onErr(err(e)))
  };
}
function queryRef(path, filters = []) {
  const q = () => query(collection(fs, path), ...filters.map(f => where(f[0], f[1], f[2])));
  return {
    where: (f, op, v) => queryRef(path, [...filters, [f, op, v]]),
    get: async () => { try { return wrapQuery(await getDocs(q())); } catch (e) { throw err(e); } },
    onSnapshot: (next, onErr) => onSnapshot(q(), s => next(wrapQuery(s)), e => onErr && onErr(err(e))),
    doc: id => docRef(path + "/" + id)
  };
}
const db = { doc: docRef, collection: p => queryRef(p) };

/* ---------- downloads: real browser downloads ---------- */
const downloads = {
  save: async ({ filename, data }) => {
    const blob = data instanceof Blob ? data : new Blob([data], { type: filename.endsWith(".html") ? "text/html;charset=utf-8" : "application/octet-stream" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000); return { status: "saved" };
  }
};

/* ---------- people ---------- */
let me = null, myRole = "pending";
const names = {};
const user = {
  id: async () => me?.uid ?? null,
  isOwner: async () => myRole === "owner",
  canEdit: async () => myRole === "owner",
  can: async () => myRole === "owner" || myRole === "staff",
  me: async () => ({ id: me?.uid ?? null, name: names[me?.uid] || "", isOwner: myRole === "owner" }),
  profiles: async ids => {
    const out = {};
    await Promise.all([...new Set([].concat(ids))].map(async id => {
      if (names[id] === undefined) { try { const s = await getDoc(doc(fs, "users/" + id)); names[id] = s.exists() ? (s.data().name || s.data().email || "") : ""; } catch { names[id] = ""; } }
      out[id] = { id, name: names[id] || "" };
    }));
    return out;
  }
};

/* ---------- login screen ---------- */
const LOGO = document.querySelector(".brand img")?.src || "icon-192.png";
const css = `
#gate{position:fixed;inset:0;z-index:200;display:grid;place-items:center;padding:20px;background:radial-gradient(900px 500px at 80% 0%,#1d4a6b,transparent 60%),#0f1e30;font-family:var(--f-body)}
#gate .box{width:min(420px,100%);background:#fff;color:#14233A;border-radius:22px;padding:28px 24px;box-shadow:0 24px 60px rgba(0,0,0,.4);text-align:center}
#gate img{width:84px;height:84px;border-radius:20px}
#gate h1{font:700 1.5rem var(--f-display);margin:12px 0 2px}#gate p{color:#62738A;margin:0 0 16px;font-size:.92rem}
#gate form{display:flex;flex-direction:column;gap:10px;text-align:right}
#gate input{border:1px solid #D6E0EA;border-radius:12px;padding:12px 14px;font:inherit;font-size:1rem}
#gate input:focus{outline:none;border-color:#1BB8DE;box-shadow:0 0 0 3px rgba(27,184,222,.25)}
#gate button{border:0;border-radius:12px;padding:12px;font:700 1rem var(--f-display);cursor:pointer;background:linear-gradient(118deg,#27C6EE,#2FD8BC);color:#06263A}
#gate .link{background:none;color:#0B84A8;font:600 .88rem var(--f-body);padding:4px}
#gate .msg{min-height:1.3em;font-size:.88rem;color:#D03A4B;text-align:center}
#gate .ok{color:#0E8A5C}
.fb-out{border:1px solid rgba(255,255,255,.15);background:transparent;color:var(--side-ink);border-radius:10px;padding:8px 12px;cursor:pointer;text-align:right}
.fb-install{border:0;border-radius:10px;padding:9px 12px;cursor:pointer;font-weight:700;background:linear-gradient(118deg,#27C6EE,#2FD8BC);color:#06263A;text-align:right}
`;
document.head.insertAdjacentHTML("beforeend", `<style>${css}</style>`);
let mode = "in";
function gate(html) {
  let g = document.getElementById("gate");
  if (!html) { g && g.remove(); return; }
  if (!g) { g = document.createElement("div"); g.id = "gate"; document.body.appendChild(g); }
  g.innerHTML = `<div class="box"><img src="${LOGO}" alt=""><h1>برنامج المرتبات</h1>${html}</div>`;
}
function loginForm(msg = "", okMsg = false) {
  const up = mode === "up";
  gate(`<p>${up ? "اعمل حساب جديد، وصاحب البرنامج هيوافق عليه" : "سجّل دخولك عشان تكمل"}</p>
   <form id="gForm">${up ? '<input id="gName" placeholder="اسمك" required autocomplete="name">' : ""}
   <input id="gEmail" type="email" placeholder="الإيميل" required autocomplete="email" dir="ltr">
   <input id="gPass" type="password" placeholder="الباسورد (6 حروف أو أرقام على الأقل)" required minlength="6" autocomplete="${up ? "new-password" : "current-password"}" dir="ltr">
   <div class="msg ${okMsg ? "ok" : ""}" id="gMsg">${msg}</div>
   <button type="submit">${up ? "إنشاء الحساب" : "دخول"}</button>
   <button type="button" class="link" id="gSwitch">${up ? "عندي حساب · تسجيل الدخول" : "مالكش حساب؟ اعمل حساب جديد"}</button>
   ${up ? "" : '<button type="button" class="link" id="gForgot">نسيت الباسورد</button>'}</form>`);
}
const arErr = e => ({ "auth/invalid-credential": "الإيميل أو الباسورد غلط", "auth/wrong-password": "الباسورد غلط", "auth/user-not-found": "مفيش حساب بالإيميل ده", "auth/email-already-in-use": "الإيميل ده عليه حساب بالفعل، سجّل دخول", "auth/weak-password": "الباسورد لازم 6 حروف أو أرقام على الأقل", "auth/invalid-email": "الإيميل مكتوب غلط", "auth/too-many-requests": "محاولات كتير، استنى شوية وجرّب تاني", "auth/network-request-failed": "مفيش إنترنت" }[e?.code] || "حصلت مشكلة، جرّب تاني");
document.addEventListener("submit", async e => {
  if (e.target.id !== "gForm") return; e.preventDefault();
  const email = document.getElementById("gEmail").value.trim(), pass = document.getElementById("gPass").value, m = document.getElementById("gMsg");
  m.className = "msg"; m.textContent = "لحظة…";
  try {
    if (mode === "up") { pendingName = document.getElementById("gName").value.trim(); const c = await createUserWithEmailAndPassword(auth, email, pass); updateProfile(c.user, { displayName: pendingName }).catch(() => {}); }
    else await signInWithEmailAndPassword(auth, email, pass);
  } catch (x) { m.textContent = arErr(x); }
});
let pendingName = "";
document.addEventListener("click", async e => {
  const t = e.target.closest("button"); if (!t) return;
  if (t.id === "gSwitch") { mode = mode === "up" ? "in" : "up"; loginForm(); }
  else if (t.id === "gForgot") { const em = document.getElementById("gEmail").value.trim(); if (!em) { document.getElementById("gMsg").textContent = "اكتب إيميلك الأول"; return; } try { await sendPasswordResetEmail(auth, em); loginForm("بعتنالك إيميل تغيّر منه الباسورد", true); } catch (x) { document.getElementById("gMsg").textContent = arErr(x); } }
  else if (t.id === "gOut" || t.dataset.logout) { await signOut(auth); location.reload(); }
  else if (t.id === "fbInstall") { if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; t.hidden = true; } else alert("من قايمة المتصفح اختار «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية»"); }
  else if (t.dataset.urole) { await setDoc(doc(fs, "users/" + t.dataset.uid), { role: t.dataset.urole }, { merge: true }); }
  else if (t.dataset.udel) { if (t.dataset.armed) { await deleteDoc(doc(fs, "users/" + t.dataset.udel)); } else { t.dataset.armed = "1"; t.textContent = "اضغط تاني للتأكيد"; setTimeout(() => { if (t.isConnected) { delete t.dataset.armed; t.textContent = "حذف"; } }, 5000); } }
});

/* ---------- users panel for the owner (shown in settings) ---------- */
let usersList = [];
window.renderUsersPanel = () => {
  if (myRole !== "owner") return "";
  const label = { owner: "صاحب البرنامج", staff: "مسؤول حضور", pending: "مستني موافقة", disabled: "موقوف" };
  const rows = usersList.filter(u => u.role !== "owner").sort((a, b) => (a.role === "pending" ? -1 : 1) - (b.role === "pending" ? -1 : 1));
  return `<div class="panel"><h2>المستخدمين</h2>
   <p class="hint">أي حد يعمل حساب من صفحة الدخول بيظهر هنا «مستني موافقة». وافق عليه عشان يقدر يسجّل الحضور. مسؤول الحضور مش بيشوف المرتبات ولا الأسعار ولا السلف.</p>
   ${rows.length ? rows.map(u => `<div class="kv"><label>${esc(u.name || u.email)}<small dir="ltr" style="text-align:right">${esc(u.email || "")}</small><small>${label[u.role] || u.role}</small></label>
     <div class="row" style="flex-wrap:nowrap;gap:6px">${u.role === "staff" ? `<button class="btn ghost sm" data-urole="disabled" data-uid="${u.id}">إيقاف</button>` : `<button class="btn sm" data-urole="staff" data-uid="${u.id}">موافقة</button>`}<button class="btn ghost sm" data-udel="${u.id}">حذف</button></div></div>`).join("") : '<p class="hint">لسه محدش عمل حساب. ابعت لينك البرنامج لمسؤول الحضور وخليه يدوس «اعمل حساب جديد».</p>'}
   </div>`;
};

/* ---------- install (PWA) ---------- */
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredPrompt = e; const b = document.getElementById("fbInstall"); if (b) b.hidden = false; });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
function sideButtons() {
  const f = document.querySelector(".side-foot"); if (!f || document.getElementById("gOut")) return;
  const standalone = matchMedia("(display-mode: standalone)").matches;
  f.insertAdjacentHTML("afterbegin", `<button class="fb-install" id="fbInstall" ${deferredPrompt && !standalone ? "" : "hidden"}>⬇ تثبيت البرنامج على الجهاز</button>`);
  f.insertAdjacentHTML("beforeend", `<button class="fb-out" id="gOut">تسجيل الخروج · ${esc(names[me?.uid] || me?.email || "")}</button>`);
}

/* ---------- auth flow ---------- */
let started = false;
async function afterLogin(u) {
  me = u;
  const ref = doc(fs, "users/" + u.uid);
  let s; try { s = await getDoc(ref); } catch (x) { gate(`<p class="msg">مش قادر أوصل لقاعدة البيانات. اتأكد إن قواعد الأمان اتحطت صح.</p><button id="gOut">تسجيل الخروج</button>`); return; }
  const isOwnerEmail = (u.email || "").toLowerCase() === OWNER_EMAIL.toLowerCase();
  if (!s.exists()) {
    await setDoc(ref, { email: u.email, name: pendingName || u.displayName || "", role: isOwnerEmail ? "owner" : "pending", createdAt: serverTimestamp() });
    s = await getDoc(ref);
  }
  myRole = s.data().role; names[u.uid] = s.data().name || u.email;
  onSnapshot(ref, d => { const r = d.exists() ? d.data().role : "pending"; if (started && r !== myRole) location.reload(); });
  if (myRole !== "owner" && myRole !== "staff") {
    gate(`<p>${myRole === "disabled" ? "حسابك موقوف. كلّم صاحب البرنامج." : "حسابك اتعمل ✓<br>مستني موافقة صاحب البرنامج، وأول ما يوافق الصفحة هتفتح لوحدها."}</p><button id="gOut">تسجيل الخروج</button>`);
    onSnapshot(ref, d => { if (d.exists() && ["staff", "owner"].includes(d.data().role)) location.reload(); });
    return;
  }
  if (myRole === "owner") onSnapshot(collection(fs, "users"), q => { usersList = q.docs.map(d => ({ id: d.id, ...d.data() })); q.docs.forEach(d => names[d.id] = d.data().name || d.data().email); if (typeof S !== "undefined" && S.tab === "set") window.render(); });
  gate(null); started = true;
  window.__fbResolve({ db, user, downloads });
  setTimeout(sideButtons, 300);
}
onAuthStateChanged(auth, u => { if (u) { if (!me) afterLogin(u); } else { me = null; loginForm(); } });
