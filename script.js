// Copilot-F1: Penaltısız Formula-1 tarzı üstten yarış örneği
// Açıklamalar ve Türkçe mesajlar eklenmiştir.

// --- Temel ayarlar ---
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;

const HUD_SPEED = document.getElementById('speed');
const HUD_DISTANCE = document.getElementById('distance');
const HUD_POSITION = document.getElementById('position');
const RESULTS = document.getElementById('results');

let paused = false;

// Yarış parametreleri
const RACE_DISTANCE = 100000; // metre
const ROAD_WIDTH = 240; // px (çizim ölçeğinde)
const SEGMENT_RESOLUTION = 10; // kaç metrede bir pist noktası üretilecek
const PIXELS_PER_METER = 0.06; // görsel ölçek (ayarlanabilir)
const PLAYER_COLOR = '#ffdd57';

// --- Track üretimi ---
// Basit bir merkez çizgisi oluşturuyoruz: her adımda açı değişimi (curvature) veriyoruz,
// açıdan x konumunu integre ederek pist merkezi elde ediyoruz.
function generateTrack(totalMeters) {
  const points = []; // her nokta: {s, x, y, angle}
  let angle = 0;
  let x = 0;
  let y = 0;
  const steps = Math.ceil(totalMeters / SEGMENT_RESOLUTION);
  // Oluştururken değişken uzunlukta dönüşler ve düz parçalar oluşturuyoruz.
  // Rastgele ama yumuşak: ortalamayı almak için birkaç komşuyla smooth edeceğiz.
  // curvature per meter
  let curvatures = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    // rastgele küçük değişiklikler
    const r = Math.random();
    if (r < 0.03) curvatures[i] = (Math.random() - 0.5) * 0.02; // güçlü dönüş
    else curvatures[i] = (Math.random() - 0.5) * 0.007; // hafif dönüş
  }
  // smooth
  for (let it = 0; it < 6; it++) {
    for (let i = 1; i < steps - 1; i++) {
      curvatures[i] = (curvatures[i - 1] + curvatures[i] + curvatures[i + 1]) / 3;
    }
  }
  // normalizasyon (çok keskin açıları azalt)
  for (let i = 0; i < steps; i++) {
    curvatures[i] = Math.max(-0.025, Math.min(0.025, curvatures[i]));
  }

  for (let i = 0; i < steps; i++) {
    // her segment bir SEGMENT_RESOLUTION metre
    const ds = SEGMENT_RESOLUTION;
    angle += curvatures[i] * ds; // derece değil, rad benzeri küçük açılar
    // x artışı: sin(angle) * ds, y artışı: cos(angle) * ds
    x += Math.sin(angle) * ds;
    y += Math.cos(angle) * ds;
    points.push({ s: i * ds, x: x, y: y, angle: angle, curvature: curvatures[i] });
  }
  return points;
}

const trackPoints = generateTrack(RACE_DISTANCE);

// Helper: pist merkezi koordinatını s (metre) değerine göre al
function sampleTrack(s) {
  if (s <= 0) return trackPoints[0];
  if (s >= trackPoints[trackPoints.length - 1].s) return trackPoints[trackPoints.length - 1];
  const idx = Math.floor(s / SEGMENT_RESOLUTION);
  const t = (s - idx * SEGMENT_RESOLUTION) / SEGMENT_RESOLUTION;
  const a = trackPoints[idx];
  const b = trackPoints[Math.min(idx + 1, trackPoints.length - 1)];
  return {
    s: s,
    x: a.x * (1 - t) + b.x * t,
    y: a.y * (1 - t) + b.y * t,
    angle: a.angle * (1 - t) + b.angle * t,
    curvature: a.curvature * (1 - t) + b.curvature * t
  };
}

// --- Oyuncular (player + bot'lar) ---
class Car {
  constructor(name, color, isPlayer = false) {
    this.name = name;
    this.color = color;
    this.isPlayer = isPlayer;
    this.s = Math.max(0, -Math.random() * 30); // pistteki ilerleme metre
    this.lateral = 0; // merkez çizgisine göre yan offset (px)
    this.speed = isPlayer ? 0 : (120 + Math.random() * 50); // km/h
    this.width = 18; // px
    this.height = 34; // px
    this.maxSpeed = isPlayer ? 350 : 330 + Math.random() * 40; // km/h
    this.acc = 220; // km/h^2 yaklaşık
    this.brake = 600;
    this.turn = 0; // -1..1 input
    this.boostAvailable = true;
    this.cooldown = 0;
    this.aiState = {
      targetOffset: 0,
      targetSpeed: this.speed
    };
    this.colorTint = color;
  }

  // Dünya koordinatına dönüş: piste s noktasına göre merkez nokta al, yan offset uygula
  getPosition() {
    const center = sampleTrack(this.s);
    // normal (perp) vektörü to the centerline (rotate angle by 90deg)
    const nx = Math.cos(center.angle);
    const ny = -Math.sin(center.angle);
    // lateral in pixels (lateral value is in px)
    const px = (center.x * PIXELS_PER_METER) + nx * this.lateral;
    const py = (center.y * PIXELS_PER_METER) - ny * this.lateral;
    return { x: px, y: py, angle: center.angle };
  }
}

// Oyuncu ve botları oluştur
const NUM_BOTS = 5;
const cars = [];
cars.push(new Car('SEN', PLAYER_COLOR, true));
const colors = ['#ff5c8a', '#6fffb0', '#b692ff', '#4cc6ff', '#ffd36f'];
for (let i = 0; i < NUM_BOTS; i++) {
  const c = new Car('BOT' + (i + 1), colors[i % colors.length], false);
  // Botları başlangıçta biraz ilerde/arkada konumlandır
  c.s = i * 8 + 30;
  c.speed = 160 + Math.random() * 100;
  cars.push(c);
}

// Input
const keys = {};
window.addEventListener('keydown', (e) => {
  keys[e.key.toLowerCase()] = true;
  if (e.key === 'p' || e.key === 'P') paused = !paused;
  if (e.code === 'Space') {
    const player = cars[0];
    if (player.boostAvailable) {
      player.speed = Math.min(player.maxSpeed * 1.12, player.speed + 80);
      player.boostAvailable = false;
      player.cooldown = 6; // saniye
    }
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => {
  keys[e.key.toLowerCase()] = false;
});

// Basit fizik / oyun döngüsü
let lastTime = performance.now();
function loop(t) {
  const dt = Math.min(0.05, (t - lastTime) / 1000); // limitle
  lastTime = t;
  if (!paused) {
    update(dt);
  }
  render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Update fonksiyonu
function update(dt) {
  // Controls
  const player = cars[0];
  // hız birim dönüşümler: km/h -> m/s = /3.6
  const toMs = (kph) => kph / 3.6;
  const toKph = (mps) => mps * 3.6;

  // Input: gaz/fren
  let accelInput = 0;
  if (keys['arrowup'] || keys['w']) accelInput = 1;
  if (keys['arrowdown'] || keys['s']) accelInput = -1;
  // Direksiyon
  let turnInput = 0;
  if (keys['arrowleft'] || keys['a']) turnInput -= 1;
  if (keys['arrowright'] || keys['d']) turnInput += 1;

  // Player physics
  const speedBefore = player.speed;
  if (accelInput > 0) {
    player.speed += player.acc * accelInput * dt;
  } else if (accelInput < 0) {
    player.speed -= player.brake * (-accelInput) * dt;
  } else {
    // doğal sürtünme
    player.speed -= Math.min(player.speed, 40 * dt);
  }
  // clamp
  player.speed = Math.max(0, Math.min(player.maxSpeed, player.speed));

  // lateral kontrol: dönüş, daha yüksek hızda dönüş zayıflıyor
  const stability = Math.max(0.12, 1 - player.speed / player.maxSpeed);
  player.lateral += turnInput * 220 * stability * dt; // px
  // frenlemeye bağlı lateral stabilize
  player.lateral *= 0.995;

  // ilerleme: s artışı = speed (m/s) * dt
  player.s += toMs(player.speed) * dt;

  // boost cooldown
  if (!player.boostAvailable) {
    player.cooldown -= dt;
    if (player.cooldown <= 0) player.boostAvailable = true;
  }

  // AI davranışı: basit hedef takipçisi
  for (let i = 1; i < cars.length; i++) {
    const bot = cars[i];
    // hedef hızı pistin yapısına göre ayarla (virajlarda biraz düşür)
    const center = sampleTrack(bot.s + 40); // öndeki pist durumu
    const curvature = Math.abs(center.curvature);
    const desired = bot.maxSpeed - curvature * 6000; // virajda az hız
    bot.aiState.targetSpeed = Math.max(80, Math.min(bot.maxSpeed, desired));
    // hız kontrol
    if (bot.speed < bot.aiState.targetSpeed) bot.speed += bot.acc * dt * (0.6 + Math.random() * 0.6);
    else bot.speed -= bot.brake * dt * 0.6;

    // lateral hedef: pist merkezine çek
    const sample = sampleTrack(bot.s + 6);
    // rastgele dalgalanma ile biraz hata ekle
    const desiredOffset = Math.sin((bot.s + i * 10) * 0.004) * 20 + (Math.random() - 0.5) * 6;
    bot.lateral += (desiredOffset - bot.lateral) * 0.8 * dt * (1 - Math.abs(sample.curvature) * 5);
    // ilerle
    bot.s += toMs(bot.speed) * dt;
    // küçük lateral sönüm
    bot.lateral *= 0.998;
    // boost mantığı: arkasındaysan ara ver
    if (Math.random() < 0.001) {
      if (bot.speed < bot.aiState.targetSpeed) bot.speed += 30;
    }
  }

  // Çarpışma çözümü (tüm arabalar arasında)
  handleCollisions(dt);

  // Yarış sonu kontrolü
  // Sıralama
  cars.sort((a, b) => b.s - a.s);
  // Eğer herhangi bir araç RACE_DISTANCE'a ulaştıysa yarışı bitir
  if (cars[0].s >= RACE_DISTANCE) {
    paused = true;
    showResults();
  }
}

// Basit dairesel çarpışma çözümü: çarpışmada araçları it, ivmeyi biraz azalt, ama oyunu bitirme.
function handleCollisions(dt) {
  // Araçların dünya pozisyonlarına dön:
  const positions = cars.map(c => {
    const p = c.getPosition();
    return { car: c, x: p.x, y: p.y, w: c.width, h: c.height };
  });
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const A = positions[i];
      const B = positions[j];
      const dx = B.x - A.x;
      const dy = B.y - A.y;
      const dist = Math.hypot(dx, dy);
      const minDist = (A.w + B.w) * 0.55; // yakınlık sınırı
      if (dist < minDist && dist > 0.001) {
        // itme vektörü
        const overlap = minDist - dist;
        const nx = dx / dist;
        const ny = dy / dist;
        // Her iki aracı birbirinden uzaklaştır
        const push = overlap * 0.5;
        A.car.lateral -= nx * push * 0.6;
        B.car.lateral += nx * push * 0.6;
        // hız kaybı
        const spdDrop = 8 + Math.random() * 12;
        A.car.speed = Math.max(10, A.car.speed - spdDrop);
        B.car.speed = Math.max(10, B.car.speed - spdDrop);
        // küçük pozisyon düzeltmesi (s değerlerine yansıma)
        A.car.s -= (ny * push) / PIXELS_PER_METER * 0.4;
        B.car.s += (ny * push) / PIXELS_PER_METER * 0.4;
      }
    }
  }
}

// --- Render (üstten görünüş) ---
function render() {
  // temizle
  ctx.clearRect(0, 0, W, H);

  // Kamera: player'ı ekranda biraz aşağıda sabitleyelim, ve dünya koordinatını kaydır
  const player = cars[0];
  const playerPos = player.getPosition();
  const camX = playerPos.x - W / 2; // sola/sağa kaydır
  const camY = playerPos.y - H * 0.65; // player ekranın yaklaşık %65 altındayken

  // Arkaplan (çim/kenarlar) — basit bir desen
  drawBackground(camX, camY);

  // Yol: trackPoints'den bir pencere çiz (player s etrafında)
  drawRoad(camX, camY, player.s);

  // Araçları çiz (arkadan öne doğru)
  const sortedByY = cars.slice().sort((a, b) => a.getPosition().y - b.getPosition().y);
  for (let c of sortedByY) {
    drawCar(c, camX, camY, c === player);
  }

  // HUD güncelle
  updateHUD();
}

// Arkaplan (sade çim)
function drawBackground(camX, camY) {
  ctx.fillStyle = '#1b4620';
  ctx.fillRect(0, 0, W, H);
  // hafif çizgiler ile hareket hissi
  ctx.strokeStyle = 'rgba(255,255,255,0.02)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 40; i++) {
    const y = ((i * 250) - ((camY) % 250));
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
}

// Yol çizme: pist merkez çizgisinin yanlarına geniş bir yol poligonu çiz
function drawRoad(camX, camY, playerS) {
  // piste ait bir pencere: player s'den geriye ve ileriye belli aralık
  const metersBack = 500;
  const metersForward = 1200;
  const startS = Math.max(0, playerS - metersBack);
  const endS = Math.min(RACE_DISTANCE, playerS + metersForward);

  // Yolun kenarlarını oluşturacak iki dizi
  const left = [];
  const right = [];

  for (let s = startS; s <= endS; s += SEGMENT_RESOLUTION) {
    const p = sampleTrack(s);
    // merkez pikselleri
    const cx = p.x * PIXELS_PER_METER - camX;
    const cy = p.y * PIXELS_PER_METER - camY;
    // perpendicular
    const nx = Math.cos(p.angle);
    const ny = -Math.sin(p.angle);
    // genişlik dinamik: virajlarda biraz daha geniş görünüm
    const width = ROAD_WIDTH + Math.abs(p.curvature) * 800;
    const lx = cx - nx * width * 0.5;
    const ly = cy - ny * width * 0.5;
    const rx = cx + nx * width * 0.5;
    const ry = cy + ny * width * 0.5;
    left.push({ x: lx, y: ly, s: s });
    right.push({ x: rx, y: ry, s: s });
  }

  // Draw road polygon
  ctx.beginPath();
  if (left.length) {
    ctx.moveTo(left[0].x, left[0].y);
    for (let p of left) ctx.lineTo(p.x, p.y);
    for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
    ctx.closePath();
    // Road fill
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#444448');
    g.addColorStop(1, '#2b2b2f');
    ctx.fillStyle = g;
    ctx.fill();

    // Road border
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#1f1f22';
    ctx.stroke();

    // Orta çizgi (kesikli)
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    ctx.setLineDash([14, 22]);
    ctx.beginPath();
    for (let i = 0; i < left.length; i++) {
      const midx = (left[i].x + right[i].x) / 2;
      const midy = (left[i].y + right[i].y) / 2;
      if (i === 0) ctx.moveTo(midx, midy);
      else ctx.lineTo(midx, midy);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

// Araç çizimi üstten
function drawCar(car, camX, camY, highlight = false) {
  const pos = car.getPosition();
  const x = pos.x - camX;
  const y = pos.y - camY;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(pos.angle);
  // gövde
  ctx.fillStyle = car.color;
  ctx.strokeStyle = highlight ? '#ffffff' : '#000000';
  roundRect(ctx, -car.width/2, -car.height/2, car.width, car.height, 3, true, true);
  // tekerlekler (sadece görsel)
  ctx.fillStyle = '#222';
  ctx.fillRect(-car.width/2 - 2, -car.height/2 + 4, 4, 10);
  ctx.fillRect(car.width/2 - 2, -car.height/2 + 4, 4, 10);
  ctx.fillRect(-car.width/2 - 2, car.height/2 - 14, 4, 10);
  ctx.fillRect(car.width/2 - 2, car.height/2 - 14, 4, 10);
  // isim
  ctx.fillStyle = '#000';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(car.name, 0, car.height/2 + 10);
  ctx.restore();
}

// rounded rect helper
function roundRect(ctx, x, y, w, h, r, fill, stroke) {
  if (typeof r === 'undefined') r = 5;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

// HUD güncelle
function updateHUD() {
  const player = cars[0];
  HUD_SPEED.textContent = `Hız: ${Math.round(player.speed)} km/h`;
  HUD_DISTANCE.textContent = `Mesafe: ${Math.floor(player.s)} / ${RACE_DISTANCE} m`;
  // sıralama: cars arrayi güncel sıralamaya göre göster
  const sorted = cars.slice().sort((a, b) => b.s - a.s);
  const pos = sorted.indexOf(player) + 1;
  HUD_POSITION.textContent = `Sıra: ${pos} / ${cars.length}`;
}

// Sonuç göster
function showResults() {
  const sorted = cars.slice().sort((a, b) => b.s - a.s);
  // Basit liste
  let html = '<h4>Yarış Bitti — Sonuçlar</h4><ol>';
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    const isYou = c === cars[0] ? ' (SEN)' : '';
    html += `<li style="color:${c.color}">${c.name}${isYou} — ${Math.floor(c.s)} m</li>`;
  }
  html += '</ol>';
  RESULTS.innerHTML = html;
  RESULTS.classList.remove('hidden');
}

// Başlangıç bilgisi konsol
console.log('Copilot-F1: Penaltısız Yarış başlatıldı. Kontroller: ok tuşları / WASD, Space boost, P duraklat.');

// Başlangıç ekranı kısaca
setTimeout(() => {
  alert('Copilot-F1: Yarış başladı! Kontroller: ok tuşları / WASD, Space boost, P duraklat. Çarpmalar oyunu bitirmez.');
}, 1200);
