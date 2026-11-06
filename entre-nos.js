const $ = (id) => document.getElementById(id);
const remoteApi = document.querySelector('meta[name="entre-nos-api"]')?.content;
const apiPrefix = remoteApi ?? "/api/entre-nos/";
const staticBase = new URL(".", location.href);
const authCookies = { device: 365 * 86400, session: 30 * 86400 };
const maxFile = 20 * 1024 * 1024;
const date = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
let role;
let file;
let draftId;
let busy = false;
let polling = false;
let firstId;
let lastId;
let activation = new URLSearchParams(location.hash.slice(1)).get("ativar");
let registration;
let pushKey;
let pushEnabled = false;
let channel;
const displayed = new Set();

async function api(path, init) {
  const options = { ...init, cache: "no-store" };
  if (remoteApi) {
    const headers = new Headers(init?.headers);
    for (const name of Object.keys(authCookies)) {
      const prefix = `__Host-entre-nos-${name}=`;
      const value = document.cookie.split(/;\s*/).find((cookie) => cookie.startsWith(prefix))?.slice(prefix.length);
      if (value) headers.set(`x-entre-nos-${name}`, value);
    }
    Object.assign(options, { headers, credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
  }
  const response = await fetch(apiPrefix + path, options);
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.message || "Não foi possível conectar. Tente de novo.");
  if (remoteApi && data.credentials) {
    for (const [name, seconds] of Object.entries(authCookies)) {
      if (!Object.hasOwn(data.credentials, name)) continue;
      const value = data.credentials[name];
      if (value !== null && !/^[A-Za-z0-9_-]{43}$/.test(value)) continue;
      document.cookie = `__Host-entre-nos-${name}=${value ?? ""}; Path=/; Max-Age=${value ? seconds : 0}; Secure; SameSite=Strict`;
    }
  }
  return data;
}

const post = (body, method = "POST") => ({ method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

function showStatus(message = "") {
  $("status").textContent = message;
  $("status").hidden = !message;
}

function entryError(message = "") {
  $("entry-error").textContent = message;
  $("entry-error").hidden = !message;
}

async function initialize() {
  $("entry-retry").hidden = true;
  entryError();
  try {
    const session = await api("session");
    if (session.role && !activation) return enter(session.role);
    if (activation || session.activated) {
      $("login").hidden = false;
      $("entry-info").textContent = activation
        ? "Digite seu nome e PIN para ativar a conversa neste aparelho."
        : "Digite seu nome e PIN para abrir a conversa.";
      return;
    }
    $("entry-info").textContent = "Abra o link de ativação que você recebeu para entrar neste aparelho.";
  } catch (error) {
    $("entry-info").textContent = "Não foi possível abrir a conversa agora.";
    entryError(error.message);
    $("entry-retry").hidden = false;
  }
}

$("entry-retry").onclick = initialize;
$("login").onsubmit = async (event) => {
  event.preventDefault();
  entryError();
  const button = $("login-button");
  button.disabled = true;
  try {
    if (activation) {
      await api("activate", post({ token: activation }));
      activation = null;
      history.replaceState(null, "", location.pathname + location.search);
      $("entry-info").textContent = "Aparelho ativado. Digite seu nome e PIN para entrar.";
    }
    const session = await api("session", post({ name: $("login-name").value, pin: $("login-pin").value }));
    $("login").reset();
    await enter(session.role);
  } catch (error) {
    entryError(error.message);
    $("login-pin").value = "";
    $("login-pin").focus();
  } finally { button.disabled = false; }
};

async function enter(member) {
  if (role) return;
  role = member;
  $("profile").textContent = role === "owner" ? "Você" : "Mamãe";
  $("invite").hidden = role !== "owner";
  $("invite-mobile").hidden = role !== "owner";
  $("entry").hidden = true;
  $("workspace").hidden = false;
  $("privacy-badge").hidden = true;
  $("lock-chat").hidden = false;
  if ("BroadcastChannel" in window) channel = new BroadcastChannel("entre-nos");
  if (channel) channel.onmessage = () => void refresh();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "new-message") void refresh();
    });
    preparePush().catch(() => {});
  }
  await refresh();
  window.setInterval(() => { if (!document.hidden) void refresh(); }, remoteApi ? 12_000 : 4500);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(); });
}

function mediaLink(item, download = false) {
  const anchor = document.createElement("a");
  anchor.href = remoteApi ? "#" : `${apiPrefix}media/${item.id}${download ? "?download=1" : ""}`;
  anchor.className = download ? "download" : "media";
  if (download) {
    anchor.textContent = item.media.type.startsWith("video/") ? "Baixar vídeo" : "Baixar foto";
    if (remoteApi) {
      anchor.onclick = async (event) => {
        event.preventDefault();
        try { location.assign((await api(`media/${item.id}?link=1&download=1`)).url); }
        catch (error) { showStatus(error.message); }
      };
    } else {
      anchor.download = item.media.name || "anexo";
    }
  } else {
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
    if (remoteApi) anchor.onclick = (event) => { if (anchor.getAttribute("href") === "#") event.preventDefault(); };
  }
  return anchor;
}

function setMediaSource(item, element, anchor) {
  if (!remoteApi) {
    element.src = `${apiPrefix}media/${item.id}`;
    return;
  }
  element.classList.add("media-loading");
  const load = async () => {
    try {
      const { url } = await api(`media/${item.id}?link=1`);
      element.src = url;
      if (anchor) anchor.href = url;
    } catch {
      if (anchor) anchor.replaceWith(mediaLink(item, true));
    } finally { element.classList.remove("media-loading"); }
  };
  if (!("IntersectionObserver" in window)) {
    void load();
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      observer.disconnect();
      void load();
    }
  }, { root: $("history"), rootMargin: "220px" });
  observer.observe(element);
}

function messageElement(item) {
  const element = document.createElement("li");
  element.className = item.author === role ? "message mine" : "message";
  const label = document.createElement("strong");
  label.textContent = item.author === role ? "Você" : item.author === "mother" ? "Mamãe" : "Da sua família";
  element.append(label);
  if (item.media) {
    const type = item.media.type;
    if (type.startsWith("video/")) {
      const video = document.createElement("video");
      video.controls = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.setAttribute("aria-label", `Vídeo ${item.media.name || "da conversa"}`);
      element.append(video, mediaLink(item, true));
      setMediaSource(item, video);
    } else {
      const image = document.createElement("img");
      image.alt = item.media.name ? `Foto ${item.media.name}` : "Foto da conversa";
      const link = mediaLink(item);
      image.addEventListener("error", () => link.replaceWith(mediaLink(item, true)), { once: true });
      link.append(image);
      element.append(link);
      setMediaSource(item, image, link);
    }
  }
  if (item.body) {
    const text = document.createElement("p");
    text.textContent = item.body;
    element.append(text);
  }
  const time = document.createElement("time");
  time.dateTime = new Date(item.sent).toISOString();
  time.textContent = date.format(item.sent);
  element.append(time);
  return element;
}

function render(items, older = false) {
  const fragment = document.createDocumentFragment();
  const scroller = $("history");
  const previousHeight = scroller.scrollHeight;
  const atBottom = scroller.scrollTop + scroller.clientHeight >= previousHeight - 115;
  const previousLast = lastId;
  for (const item of items) {
    if (displayed.has(item.id)) continue;
    displayed.add(item.id);
    firstId = Math.min(firstId ?? item.id, item.id);
    lastId = Math.max(lastId ?? item.id, item.id);
    fragment.append(messageElement(item));
    if (!older && item.id === lastId) {
      $("sidebar-preview").textContent = item.body || (item.media?.type.startsWith("video/") ? "Vídeo" : "Foto");
    }
  }
  $("empty").hidden = displayed.size > 0;
  if (older) {
    $("messages").prepend(fragment);
    scroller.scrollTop += scroller.scrollHeight - previousHeight;
  } else {
    $("messages").append(fragment);
    if (atBottom && previousLast !== lastId) scroller.scrollTop = scroller.scrollHeight;
  }
}

async function refresh() {
  if (polling || !role) return;
  polling = true;
  try {
    const initial = !lastId;
    let data;
    do {
      data = await api(`messages${lastId ? `?after=${lastId}` : ""}`);
      render(data.messages);
      if (initial) $("older").hidden = !data.more;
    } while (!initial && data.more);
    if ($("status").dataset.connection) {
      delete $("status").dataset.connection;
      showStatus();
    }
  } catch (error) {
    if ($("status").hidden) {
      showStatus(error.message);
      $("status").dataset.connection = "1";
    }
  } finally { polling = false; }
}

$("older").onclick = async () => {
  const button = $("older");
  button.disabled = true;
  try {
    const data = await api(`messages?before=${firstId}`);
    render(data.messages, true);
    button.hidden = !data.more;
  } catch (error) { showStatus(error.message); }
  finally { button.disabled = false; }
};

function changeFile(selected) {
  file = selected;
  draftId = null;
  $("attachment").hidden = !file;
  $("attachment-name").textContent = file?.name || "";
  if (!file) $("file").value = "";
}

$("attach").onclick = () => $("file").click();
$("remove").onclick = () => changeFile();
$("file").onchange = () => {
  const selected = $("file").files[0];
  if (!selected) return;
  if (selected.size > maxFile || selected.size === 0) {
    changeFile();
    showStatus("Escolha um arquivo de até 20 MB.");
    return;
  }
  changeFile(selected);
  showStatus();
};
$("message").oninput = () => {
  draftId = null;
  const input = $("message");
  input.style.height = "";
  input.style.height = `${Math.min(120, input.scrollHeight + 2)}px`;
};
$("message").onkeydown = (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing && matchMedia("(pointer: fine)").matches) {
    event.preventDefault();
    $("compose").requestSubmit();
  }
};

$("compose").onsubmit = async (event) => {
  event.preventDefault();
  const input = $("message");
  const body = input.value.trim();
  if (busy || (!body && !file)) return;
  busy = true;
  delete $("status").dataset.connection;
  const fields = [$("send"), $("attach"), $("remove"), input];
  fields.forEach((field) => field.disabled = true);
  showStatus(file ? "Enviando anexo…" : "Enviando mensagem…");
  const form = new FormData();
  draftId ??= crypto.randomUUID();
  form.set("id", draftId);
  form.set("body", body);
  if (file) form.set("file", file);
  try {
    await api("messages", { method: "POST", body: form });
    input.value = "";
    input.style.height = "";
    changeFile();
    showStatus();
    channel?.postMessage("message");
    await refresh();
    $("history").scrollTop = $("history").scrollHeight;
  } catch (error) { showStatus(error.message); }
  finally {
    busy = false;
    fields.forEach((field) => field.disabled = false);
    if (matchMedia("(pointer: fine)").matches) input.focus();
  }
};

function dialog(icon, title, detail, action, handler) {
  $("dialog-icon").firstElementChild.setAttribute("href", `#${icon}`);
  $("dialog-title").textContent = title;
  $("dialog-info").textContent = detail;
  $("dialog-result").textContent = "";
  $("invite-field").hidden = true;
  $("dialog-secondary").hidden = true;
  const button = $("dialog-action");
  button.textContent = action ?? "";
  button.hidden = !action;
  button.onclick = async () => {
    button.disabled = true;
    try { await handler(); } catch (error) { $("dialog-result").textContent = error.message; }
    finally { button.disabled = false; }
  };
  if (!$("settings").open) $("settings").showModal();
}

function openInvite(target = "mother") {
  let inviteUrl;
  const forMother = target === "mother";
  const title = forMother ? "Convide sua mãe" : "Ative outro aparelho seu";
  const instructions = forMother
    ? "Mande o link para ela abrir no próprio celular. Ele vale por dois dias e ativa um aparelho. Depois, ela entra com o nome e o PIN."
    : "Abra o link no seu outro aparelho e entre com seu nome e PIN. O link vale por dois dias.";
  dialog("link", title, instructions,
    "Copiar link de ativação", async () => {
      if (!inviteUrl) {
        const { token } = await api("invite", post({ target }));
        inviteUrl = `${new URL("entre-nos.html", staticBase)}#ativar=${token}`;
      }
      $("invite-field").hidden = false;
      $("invite-url").value = inviteUrl;
      try {
        await navigator.clipboard.writeText(inviteUrl);
        $("dialog-result").textContent = "Link copiado.";
      } catch {
        $("invite-url").select();
        $("dialog-result").textContent = "Selecione e copie o link acima.";
      }
    });
}
$("invite").onclick = () => openInvite();
$("invite-mobile").onclick = () => openInvite();
$("lock-chat").onclick = () => {
  dialog("lock", "Bloquear conversa", "Para voltar à conversa neste aparelho, digite seu nome e PIN.",
    "Bloquear agora", async () => {
      await api("session", post({}, "DELETE"));
      location.reload();
    });
  $("dialog-secondary").hidden = role !== "owner";
};
$("dialog-secondary").onclick = () => openInvite("owner");

function updatePush(enabled) {
  pushEnabled = enabled;
  $("notify").lastElementChild.textContent = enabled ? "Avisos ligados" : "Ativar avisos";
}

async function preparePush() {
  if (!("PushManager" in window) || !("Notification" in window)) return;
  const [service, key] = await Promise.all([
    navigator.serviceWorker.register(new URL("entre-nos-sw.js", staticBase)), api("push-key"),
  ]);
  registration = service.active ? service : await navigator.serviceWorker.ready;
  pushKey = Uint8Array.from(atob(key.key.replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0));
  const subscription = await registration.pushManager.getSubscription();
  if (subscription && Notification.permission === "granted") {
    await api("subscription", post(subscription));
    updatePush(true);
  }
}

$("notify").onclick = () => {
  const appleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (appleMobile && !navigator.standalone && !matchMedia("(display-mode: standalone)").matches) {
    return dialog("bell", "Avisos no iPhone ou iPad", "No Safari, toque em Compartilhar e em Adicionar à Tela de Início. Abra o Entre Nós pelo novo ícone e toque em Ativar avisos.");
  }
  if (!("PushManager" in window) || !("Notification" in window)) {
    return dialog("bell", "Avisos neste aparelho", "Este navegador não oferece avisos em segundo plano. As novas mensagens aparecem enquanto a conversa está aberta.");
  }
  if (Notification.permission === "denied") {
    return dialog("bell", "Avisos bloqueados", "Permita as notificações para este site nos ajustes do navegador e volte a esta conversa.");
  }
  if (!registration || !pushKey) {
    preparePush().catch(() => {});
    return dialog("bell", "Preparando avisos", "Feche esta janela e toque em Ativar avisos novamente em alguns instantes.");
  }
  if (pushEnabled) {
    return dialog("bell", "Avisos ligados", "Este aparelho pode avisar quando chegar algo novo.", "Desativar neste aparelho", async () => {
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await api("subscription", post({ endpoint: subscription.endpoint }, "DELETE"));
        await subscription.unsubscribe();
      }
      updatePush(false);
      $("settings").close();
    });
  }
  dialog("bell", "Receber avisos", "Seu aparelho pode avisar quando chegar uma mensagem, foto ou vídeo. O conteúdo fica dentro da conversa.", "Permitir avisos", async () => {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("Para receber avisos, permita as notificações neste aparelho.");
    const current = await registration.pushManager.getSubscription();
    const subscription = current ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: pushKey });
    await api("subscription", post(subscription));
    updatePush(true);
    $("settings").close();
  });
};

void initialize();
