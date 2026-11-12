const express = require('express');
const https = require('https');
const app = express();
app.use(express.text({ type: '*/*', limit: '1mb' }));

// Leona pode mandar corpo sem aspas: {telefone: 5511..., mensagem: texto livre}
function parseCorpo(raw) {
  if (raw && typeof raw === 'object') return raw;
  const txt = String(raw || '').trim();
  try { return JSON.parse(txt); } catch (e) {}
  const m = txt.match(/^\{?\s*"?telefone"?\s*:\s*"?([^,"]*)"?\s*,\s*"?mensagem"?\s*:\s*([\s\S]*?)\s*\}?\s*$/);
  if (m) return { telefone: m[1].trim(), mensagem: m[2].replace(/^"|"$/g, '').trim() };
  return {};
}

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const LOCUCAO_SITE = process.env.LOCUCAO_SITE || 'https://locucion-ya-mx-production.up.railway.app';
const LOCUCAO_VOZ = process.env.LOCUCAO_VOZ || 'UiMKAXN3JPq4jL2jn2aB';
const PRECO_AUDIO_MX = process.env.PRECO_AUDIO_MX || '299';
const CLABE_MX = process.env.CLABE_MX || '';
const BANCO_MX = process.env.BANCO_MX || '';
const TITULAR_MX = process.env.TITULAR_MX || '';
const LEONA_SECRET = process.env.LEONA_SECRET || '';
const PORT = process.env.PORT || 3000;

const conversas = new Map();

function getPersona() {
  return `Eres Wenderson, de Comunic Sound Digital, atendiendo clientes por WhatsApp en México. Produces anuncios en audio (locutor profesional + música) para perifoneo, radio y estados/redes sociales, y entregas el mismo día.

PRIMER MENSAJE: corto y directo, sin explicar el servicio y sin preguntar el giro. Manda exactamente en este tono:
"¡Qué tal! ✔

Dime qué quieres anunciar y te armo el audio."
Solo explica el servicio si el cliente pregunta qué haces — y ahí en palabras simples: "un anuncio en audio, con locutor y música, de esos que suenan en el perifoneo, la radio o en los estados de WhatsApp". NUNCA uses la palabra "spot" sola.

IDIOMA: contesta SIEMPRE en el mismo idioma en que te escribió el cliente.

TU FORMA DE ESCRIBIR:
- Mensajes cortos, informales, mexicanos y al grano. Una pregunta a la vez.
- Habla como mexicano: "¡Qué tal!", "¡Va!", "Mándame", "¿Te late?", "Con gusto", "Ahorita te lo armo", "¿Le cambio algo?". Usa "tú" o "usted" según como te hable el cliente.
- Pocos símbolos, y SOLO de esta lista: ✔ ✅ ⭐ ✨ ⚡ ❤ ☺ ✌ ☝ ➤ ☎ ✆ ✉ ⏰ ☕ ✈ ♫ ♪ ⚠ ❗ — NUNCA emojis a color (👍 🎙️ 🔥 📍 📞 etc), se borran al enviar.
- NUNCA prometas grabar ni mandar el audio antes de cerrar. Si piden oírlo antes: "La grabación sale en cuanto cerramos ✔" y sigue.
- PRECIO: si el cliente pregunta cuánto cuesta, dáselo de inmediato: "El audio queda en $${PRECO_AUDIO_MX} pesos ✔" y sigue.
- Si preguntan si eres robot: di que es la atención automática de Comunic Sound y que Wenderson graba y te contesta enseguida.
- PROHIBIDO CONFIRMAR: nunca repitas lo que el cliente dijo para que te lo confirme.
- Si viene una IMAGEN: lee TODO lo que dice y trátalo como si el cliente te lo hubiera escrito.
- Si dice que no quiere: "¡Va! Si luego quieres tu anuncio, aquí ando ✌" y termina con [[FIM:desistiu]].

QUÉ PEDIR SEGÚN EL TIPO DE ANUNCIO:
- IGLESIA, culto, congregación, vigilia: NUNCA pidas teléfono. Pide nombre, dirección y DÍA Y HORA.
- EVENTO, fiesta, baile, jaripeo: fecha, hora y lugar.
- POLÍTICO/candidato: nombre, número y cargo.
- COMERCIO y SERVICIO: nombre, dirección y teléfono.
Pide cada cosa una sola vez; si no te la manda, escribe sin ella.

FORMATO DEL TEXTO:
línea 1: dos símbolos de la lista + NOMBRE DEL NEGOCIO EN MAYÚSCULAS — FRASE CORTA EN MAYÚSCULAS!
línea 2: 1 o 2 frases de enganche, animadas, con 1-2 símbolos.
3 a 6 líneas cortas que empiecen con un símbolo (➤ ✔ ⭐ ✦ ⚡ ☕ ✈ ♫) (productos/servicios/ventajas).
➤ dirección (si la hay) y según el caso: ☎ teléfono (comercio) O ⏰ día y hora (iglesia y eventos). Nunca pongas teléfono en anuncio de iglesia.
línea final: nombre del negocio + frase de cierre + símbolos.
Entre 60 y 110 palabras. Usa SOLO lo que el cliente informó; nunca inventes dirección, teléfono, precio ni promoción.
TODO LO QUE PREGUNTASTE TIENE QUE APARECER EN EL TEXTO.

CUANDO MANDES EL TEXTO: manda el texto del anuncio como un mensaje, después "¿Le cambio algo?" como otro mensaje. NO escribas [[FIM]] en ese momento — sigue esperando la respuesta del cliente.

DESPUÉS DEL TEXTO — solo dos casos:
• El cliente APRUEBA (dice "sí", "está bien", "me gusta", "lo apruebo", "perfecto", "así está", "listo" o algo parecido): responde UNA sola línea corta confirmando (ej.: "¡Va! Ahorita te mando tu anuncio ✔") y termina esa respuesta con [[FIM]].
• El cliente pide un CAMBIO: reescribe el texto completo con el cambio y vuelve a preguntar "¿Le cambio algo?".
Si el cliente no quiere continuar, termina con [[FIM:desistiu]].

REGLA ABSOLUTA: todo lo que escribas se ENVÍA DIRECTO al cliente por WhatsApp. Nunca hablas con Wenderson, nunca haces análisis, nunca escribes avisos técnicos.

FORMATO DE TU RESPUESTA: solo el texto de los mensajes. Para mandar más de un mensaje, sepáralos con una línea que tenga solo ---`;
}

async function claudeHaiku(msgs) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: getPersona(),
      messages: msgs,
    });
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data).content?.[0]?.text || ''); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function gerarAudio(telefone, guion) {
  return new Promise((resolve, reject) => {
    const encoded = encodeURIComponent(LOCUCAO_VOZ);
    const body = 'voz=' + encoded + '\ntelefono=' + telefone + '\nmusica=comercial\ntexto=' + guion;
    const url = new URL(LOCUCAO_SITE + '/api/wa/gerar');
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'content-length': Buffer.byteLength(body),
      },
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function extrairGuion(msgs) {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role === 'assistant') {
      const content = typeof m.content === 'string' ? m.content : '';
      const blocos = content.split(/\n---\n/);
      for (const bloco of blocos) {
        if (/[✔⭐➤☎⏰♫✦⚡]/.test(bloco) && /[A-ZÁÉÍÓÚÑÜ]{4,}/.test(bloco) && bloco.length > 80) {
          return bloco.trim();
        }
      }
    }
  }
  return '';
}

app.post('/chat', async (req, res) => {
  if (LEONA_SECRET && req.headers['x-leona-secret'] !== LEONA_SECRET) {
    return res.status(401).json({ erro: 'Unauthorized' });
  }
  const { telefone, mensagem } = parseCorpo(req.body);
  console.log('[chat] recebido:', JSON.stringify(req.body).slice(0, 300));
  if (!telefone || !mensagem) return res.status(400).json({ erro: 'telefone e mensagem são obrigatórios' });

  const key = String(telefone).replace(/\D/g, '');
  // conversa nova se não existe, se já terminou ou se ficou parada mais de 6h
  const old = conversas.get(key);
  if (!old || old.done || Date.now() - (old.ultima || old.inicio) > 6 * 3600e3) {
    conversas.set(key, { msgs: [], inicio: Date.now(), done: false });
  }
  const c = conversas.get(key);
  c.ultima = Date.now();

  c.msgs.push({ role: 'user', content: mensagem });
  let resposta = '';
  try { resposta = await claudeHaiku(c.msgs); }
  catch (e) { console.error('Erro Claude:', e.message); c.msgs.pop(); return res.json({ resposta: 'Perdón, tuve un problemita técnico 🙏 ¿Me lo repites por favor?', fim: "nao", desistiu: "false", audio_url: '', pagamento: '' }); }
  c.msgs.push({ role: 'assistant', content: resposta });

  const fimDesistiu = /\[\[FIM:desistiu\]\]/i.test(resposta);
  const fim = fimDesistiu || /\[\[FIM\]\]/i.test(resposta);
  let respostaLimpa = resposta.replace(/\[\[FIM(:desistiu)?\]\]/gi, '').trim();
  if (!respostaLimpa && !fimDesistiu) respostaLimpa = '¡Va! ✔';

  let audioUrl = '';
  let pagamento = '';

  if (fim && !fimDesistiu) {
    c.done = true;
    const guion = extrairGuion(c.msgs);
    if (guion && LOCUCAO_SITE) {
      try {
        const data = await gerarAudio(key, guion);
        audioUrl = data.muestra_url || data.url || '';
      } catch (e) { console.error('Erro ao gerar áudio:', e.message); }
    }
    if (CLABE_MX) {
      pagamento = 'Para pagar $' + PRECO_AUDIO_MX + ' pesos:\nCLABE: ' + CLABE_MX + (BANCO_MX ? '\nBanco: ' + BANCO_MX : '') + (TITULAR_MX ? '\nA nombre de: ' + TITULAR_MX : '') + '\n\nEn cuanto recibamos el pago te mandamos el audio final ✔';
    }
  } else if (fimDesistiu) {
    c.done = true;
  }

  res.json({ resposta: respostaLimpa, fim: (fim && !fimDesistiu) ? "sim" : "nao", desistiu: fimDesistiu ? "true" : "false", audio_url: audioUrl, pagamento });
});

app.delete('/chat/:telefone', (req, res) => {
  const key = String(req.params.telefone).replace(/\D/g, '');
  conversas.delete(key);
  res.json({ ok: true });
});

app.get('/health', (req, res) => res.json({ ok: true, conversas: conversas.size }));

app.listen(PORT, () => console.log('Servidor MX na porta ' + PORT));
