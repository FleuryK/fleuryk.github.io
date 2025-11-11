// ===== CONFIG =====
const discordUserId = "130979396134633472";										// Remplace par ton ID Discord
const githubUser = "fleuryk";													// Remplace par ton pseudo GitHub

// ===== DISCORD =====
const ws = new WebSocket("wss://api.lanyard.rest/socket");

// utilitaire: avatar par défaut si pas d’avatar custom
function getAvatarURL(user) {
	if (user.avatar) {
		return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
	}
	let idx = 0;
	if (user.discriminator && user.discriminator !== "0") {
		idx = Number(user.discriminator) % 5;
	}
	return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}

// mapping statut -> classes + libellés EN
const STATUS = {
	online: { cls: "status-online",  label: "Online" },
	idle:   { cls: "status-idle",    label: "Idle" },
	dnd:    { cls: "status-dnd",     label: "Do Not Disturb" },
	offline:{ cls: "status-offline", label: "Offline" }
};

function applyPresence(d) {
	// Avatar + pseudo
	const user = d.discord_user;
	document.getElementById("discord-avatar").src = getAvatarURL(user);

	const discr = (user.discriminator && user.discriminator !== "0") ? `#${user.discriminator}` : "";
	document.getElementById("discord-username").textContent =
		user.username ? `@${user.username}${discr}` : "";

	// Dot + texte
	const status = d.discord_status || "offline";
	const dot = document.getElementById("discord-status-dot");
	const text = document.getElementById("discord-status-text");
	const map = STATUS[status] || STATUS.offline;
	dot.className = "status-dot " + map.cls;
	text.textContent = map.label;

	// Activité
	applyActivity(d);
}

/* ---------- Activité en cours (Spotify prioritaire) ---------- */
const elActivity = document.getElementById("activity");
const elActName  = document.getElementById("activity-name");
const elActDet   = document.getElementById("activity-details");

// Résout l’URL d’icône d’activité (Discord assets / media proxy / app assets)
function resolveActivityIcon(act) {
	if (!act || !act.assets) return null;

	const large = act.assets.large_image || act.assets.small_image;
	if (!large) return null;

	// Media proxy (commence par "mp:")
	if (typeof large === "string" && large.startsWith("mp:")) {
		const path = large.replace(/^mp:/, "");
		return `https://media.discordapp.net/${path}`;
	}

	// Spotify (ignore, on gère via d.spotify)
	if (typeof large === "string" && large.startsWith("spotify:")) {
		return null;
	}

	// App assets (numeric id)
	if (/^\d+$/.test(large) && act.application_id) {
		return `https://cdn.discordapp.com/app-assets/${act.application_id}/${large}.png`;
	}

	// Par défaut, tenter direct
	return large || null;
}

function applyActivity(d) {
	// 1) Spotify prioritaire
	if (d.listening_to_spotify && d.spotify) {
		const s = d.spotify;
		elActivity.hidden = false;
		elActName.textContent = "Listening on Spotify: ";
		elActDet.textContent  = `${s.artist || "Unknown artist"} – ${s.song || "Unknown title"}`;
		return;
	}

	// 2) Autre activité (hors Custom Status)
	const act = (d.activities || []).find(a => a && a.type !== 4);
	if (act) {
		elActivity.hidden = false;
		elActName.textContent = act.name || "Activity";
		const parts = [];
		if (act.details) parts.push(act.details);
		if (act.state)   parts.push(act.state);
		elActDet.textContent = parts.join(" — ") || "";
		return;
	}

	// 3) Aucune activité
	elActivity.hidden = false;
	elActName.textContent = "";
	elActDet.textContent = "None";
}

/* ---------- WebSocket Lanyard + Heartbeat ---------- */

let heartbeatTimer = null;

ws.onopen = () => {
	ws.send(JSON.stringify({
		op: 2,
		d: { subscribe_to_id: discordUserId }
	}));
};

ws.onmessage = (event) => {
	const msg = JSON.parse(event.data);

	// HELLO: démarrer le heartbeat + (ré)abonnement sûr
	if (msg.op === 1 && msg.d && msg.d.heartbeat_interval) {
		clearInterval(heartbeatTimer);
		heartbeatTimer = setInterval(() => {
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({ op: 3 }));
			}
		}, msg.d.heartbeat_interval);

		ws.send(JSON.stringify({
			op: 2,
			d: { subscribe_to_id: discordUserId }
		}));
		return;
	}

	// Traiter uniquement l’état initial et les updates
	if (msg.t !== "INIT_STATE" && msg.t !== "PRESENCE_UPDATE") return;

	applyPresence(msg.d);
};

ws.onclose = () => {
	clearInterval(heartbeatTimer);
	heartbeatTimer = null;
	// (Optionnel) Reconnexion auto:
	// setTimeout(() => location.reload(), 2000);
};

ws.onerror = () => {
	try { ws.close(); } catch (_) {}
};

// ===== GITHUB =====
fetch(`https://api.github.com/users/${githubUser}/events/public`)
	.then(res => res.json())
	.then(events => {
	const lastEvent = events[0];
	let html = "";

	if (lastEvent) {
		const repo = lastEvent.repo.name;
		const date = new Date(lastEvent.created_at).toLocaleString("en-US");

		// Traduction du type d’événement
		let action = "";
		switch (lastEvent.type) {
			case "PushEvent":
				const commits = Array.isArray(lastEvent.payload.commits) ? lastEvent.payload.commits.length : 0;
				action = commits > 0
					? `A push ${commits} commit(s)`
					: "A push action (no commits)";
				break;
			case "CreateEvent":
				action = "A created a repository or a branch";
				break;
			case "IssuesEvent":
				action = `A issue ${lastEvent.payload.action} `;
				break;
			case "IssueCommentEvent":
				action = `A commented on an issue`;
				break;
			case "PullRequestEvent":
				action = `A ${lastEvent.payload.action} pull request`;
				break;
			case "WatchEvent":
				action = "A star the repo";
				break;
			case "ForkEvent":
				action = "A fork the repo";
				break;
			default:
				action = `Made an action (${lastEvent.type})`;
		}

		html += `<span>${action} on repo <a href="https://github.com/${repo}" target="_blank">${repo}</a> - ${date}</span>`;
	} else {
		html = "<span>No activity recently.</span>";
	}

	document.getElementById("github-activity").innerHTML = html;
});


// ===== JOKE OR QUOTE =====
async function getJoke() {
	const res = await fetch("https://icanhazdadjoke.com/", {
		headers: { Accept: "application/json" }
	});
	const data = await res.json();
	return { text: data.joke, source: "Joke" };
}

async function getQuote() {
	const res = await fetch("https://dummyjson.com/quotes/random");
	const data = await res.json();
	return { text: data.quote, source: data.author };
}

async function showRandom() {
	try {
		const pick = Math.random() < 0.5 ? "joke" : "quote";
		const { text, source } = pick === "joke" ? await getJoke() : await getQuote();

		document.getElementById("jokeorquote").innerHTML = '<figure>' +
		'	<blockquote class="blockquote">' +
		'		<p>'+ text +'</p>' +
		'	</blockquote>' +
		'	<figcaption class="blockquote-footer">'+
		'		<span style="font-style: italic;">'+ source +'</span>' +
		'	</figcaption>' +
		'</figure>';
	} catch (err) {
		document.getElementById("jokeorquote").innerHTML = "<span>Oops, failed to load. Try again later.</span>";
	}
}

// Run once on page load
showRandom();


// ===== TIME IN MY COUNTRY =====
function afficherHeureFr() {
	const options = {
		timeZone: 'Europe/Paris',
		hour: '2-digit',
		minute: '2-digit'
	};
	const now = new Date().toLocaleTimeString('fr-FR', options);
	document.getElementById('time-in-my-country').textContent = now;
}

// Mettre à jour toutes les secondes
setInterval(afficherHeureFr, 1000);
afficherHeureFr(); // exécution immédiate au chargement
