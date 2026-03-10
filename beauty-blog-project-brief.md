# GLOW INTEL — Automated Beauty & Ecommerce Blog
## Project Brief para Claude Code

---

## 1. QUÉ ES ESTE PROYECTO

Un blog en inglés sobre skincare, beauty y ecommerce beauty que corre casi en piloto automático con IA. El objetivo es generar tráfico orgánico masivo a través de contenido SEO optimizado (3-4 posts/semana) y monetizar con ads (AdSense → Mediavine/AdThrive cuando haya tráfico suficiente).

**Owner:** Angelo — freelance web developer, conoce skincare profundamente (tiene su propio negocio de skincare), pero no quiere dedicar más de 30 min/semana a este blog una vez que esté corriendo.

**Modelo de negocio:** Tráfico orgánico → Ad revenue. Eventualmente: affiliate links a productos de skincare.

---

## 2. DECISIÓN TÉCNICA: ¿POR QUÉ ASTRO + CLOUDFLARE Y NO FRAMER?

### Framer: Por qué NO para este proyecto
- Framer es excelente para landing pages y sitios comerciales (Angelo ya lo usa para clientes)
- PERO para un blog de contenido masivo con publicación automatizada, tiene limitaciones:
  - El CMS de Framer no tiene API pública robusta para publicación automatizada via scripts
  - El Framer MCP requiere tener el plugin ABIERTO en Framer para funcionar (no es headless)
  - Framer cobra mensualmente y escala con el número de páginas CMS
  - No podés hacer git push → deploy automático fácilmente

### Astro + Cloudflare Pages: Por qué SÍ
- **$0 de hosting** — Cloudflare Pages es gratis (bandwidth ilimitado, CDN global)
- **Astro fue adquirido por Cloudflare** en enero 2026 — integración nativa perfecta
- **Markdown-based** — cada blog post es un archivo .md que Claude puede crear directamente
- **Git-based workflow** — Claude escribe el .md, lo commitea a GitHub, Cloudflare redeploya automáticamente
- **100/100 en PageSpeed** — Astro genera HTML estático, cero JavaScript innecesario
- **SEO perfecto de fábrica** — sitemaps automáticos, meta tags, schema markup, RSS feed
- **No necesitás saber código** — Claude Code hace TODO, vos solo revisás

### Stack final
| Componente | Herramienta | Costo |
|-----------|-------------|-------|
| Framework | Astro (v5 o v6) | Gratis |
| Hosting | Cloudflare Pages | Gratis |
| Repo + CI/CD | GitHub + GitHub Actions | Gratis |
| Dominio | Cualquier registrar (Porkbun, Namecheap, Cloudflare) | ~$10-15/año |
| Contenido | Claude (vía Claude Pro subscription) | Ya pagado |
| Keyword Research | Google autocomplete + scraping (gratis) o Keywords Everywhere ($10/mes) | $0-10/mes |
| Imágenes | Unsplash API (gratis) | Gratis |
| Analytics | Google Search Console + Google Analytics 4 | Gratis |

**Costo mensual real: $0-10/mes** (sin contar Claude Pro que ya tenés)

---

## 3. ARQUITECTURA DEL PROYECTO

```
glow-intel/                          ← nombre del proyecto (cambiar si querés)
├── .github/
│   └── workflows/
│       └── publish.yml              ← GitHub Action para auto-publicación (Fase 3)
├── .claude/
│   ├── CLAUDE.md                    ← Instrucciones persistentes para Claude Code
│   ├── commands/
│   │   ├── research.md              ← /research — buscar keywords
│   │   ├── write.md                 ← /write — escribir un post
│   │   ├── optimize.md              ← /optimize — mejorar un post existente
│   │   └── publish.md               ← /publish — commitear y deployar
│   ├── skills/                      ← Skills de SEO instaladas
│   └── agents/                      ← Sub-agentes especializados
├── src/
│   ├── content/
│   │   └── blog/                    ← TODOS los posts van acá como .md
│   │       ├── best-retinol-serums-2026.md
│   │       ├── niacinamide-vs-vitamin-c.md
│   │       └── ...
│   ├── pages/
│   │   ├── index.astro              ← Homepage
│   │   ├── blog/
│   │   │   ├── index.astro          ← Blog listing
│   │   │   └── [...slug].astro      ← Post individual
│   │   ├── about.astro
│   │   └── categories/
│   │       └── [...category].astro
│   ├── layouts/
│   │   ├── BaseLayout.astro
│   │   └── BlogPost.astro
│   ├── components/
│   │   ├── Header.astro
│   │   ├── Footer.astro
│   │   ├── PostCard.astro
│   │   ├── SEOHead.astro
│   │   └── TableOfContents.astro
│   └── styles/
│       └── global.css
├── public/
│   ├── images/                      ← Imágenes de posts
│   ├── favicon.svg
│   └── robots.txt
├── content-pipeline/                ← Scripts de automatización
│   ├── keyword-research.js          ← Script de búsqueda de keywords
│   ├── serp-scraper.js              ← Scrapea page 1 de Google
│   ├── post-generator.js            ← Genera el .md del post
│   ├── image-fetcher.js             ← Busca imagen en Unsplash
│   └── ai-slop-detector.js          ← Limpieza de patrones robóticos
├── source-material/                 ← Material de referencia permanente
│   ├── voice-bank.md                ← Transcripción de tu brain dump
│   ├── style-guide.md               ← Guía de estilo del blog
│   └── keyword-tracker.json         ← Keywords ya usadas (evitar duplicados)
├── astro.config.mjs
├── package.json
├── tailwind.config.mjs
└── .env                             ← API keys (NO commitear)
```

---

## 4. SKILLS Y HERRAMIENTAS PARA INSTALAR EN CLAUDE CODE

### Prioridad 1: Instalar primero (esenciales)

**SEO Machine** — El más completo para blog content
```bash
git clone https://github.com/TheCraigHewitt/seomachine.git
# Copiar commands, agents y skills a tu proyecto
```
Incluye: /research, /write, /rewrite, /optimize, /publish-draft, detector de AI slop, 26 skills de marketing

**Claude SEO Skills** — SEO técnico y auditoría
```bash
curl -fsSL https://raw.githubusercontent.com/AgriciDaniel/claude-seo/main/install.sh | bash
```
Incluye: 13 sub-skills, 6 subagentes, schema markup, E-E-A-T, sitemap generation

### Prioridad 2: Instalar después (complementarias)

**SEO + GEO Skills** — Optimización para AI search (Google AI Overviews, ChatGPT citations)
```bash
npx skills add aaron-he-zhu/seo-geo-claude-skills
```

**Marketing Skills** — Copywriting, CRO, analytics
```bash
npx skillkit install coreyhaines31/marketingskills
```

### MCPs útiles (opcional, agregar cuando sea necesario)
- **Framer MCP** — NO para el blog, pero sí para tus otros proyectos de cliente
- **Google Search Console MCP** — para tracking de performance una vez que el blog tenga tráfico
- **Unsplash MCP** — si existe, para buscar imágenes automáticamente

---

## 5. WORKFLOW: CÓMO SE CREA UN POST (paso a paso)

### Paso 1: Keyword Research
Claude busca keywords usando:
- Google autocomplete scraping (gratis) — `skincare routine for...`, `best retinol...`
- "People Also Ask" extraction
- Opcional: Keywords Everywhere API ($10/mes para data de volumen)

Criterios de selección:
- **Long-tail keywords** (3+ palabras) — menos competencia
- **Search intent informacional** — "how to", "best", "vs", "for beginners"
- **Volume 500-5000/mes** — sweet spot para blog nuevo
- **Keyword difficulty baja** — evitar keywords donde rankean Sephora, Allure, etc.

Ejemplos de keywords buenas para este nicho:
- "niacinamide vs vitamin c which one first"
- "best affordable retinol for beginners"
- "how to start a skincare brand online"
- "skincare routine order for oily skin"
- "is cerave actually good reddit"
- "beauty ecommerce trends 2026"

### Paso 2: Research de competencia
Claude scrapea los top 5-10 resultados de Google para esa keyword:
- Extrae la estructura (H1, H2s, largo del contenido)
- Identifica qué cubren y qué NO cubren
- Encuentra el "content gap" — lo que falta en los resultados actuales

### Paso 3: Escritura del post
Claude escribe el post usando:
1. **Keyword data** del paso 1
2. **Análisis de competencia** del paso 2
3. **Voice bank** (tu brain dump transcripto — tus opiniones reales)
4. **Style guide** (ver sección 7)

El post se genera como un archivo .md con:
- Frontmatter completo (title, description, date, category, tags, image)
- Estructura H2/H3 optimizada para SEO
- Internal links a otros posts del blog
- Imagen hero (buscada en Unsplash)
- Meta description optimizada

### Paso 4: AI Slop Detection
Antes de publicar, el post pasa por un filtro que:
- Elimina em-dashes excesivos (—)
- Reemplaza filler phrases ("In today's fast-paced world", "It's worth noting that", "Let's dive in")
- Detecta patrones robóticos (frases que empiezan con "Furthermore", "Moreover", "Additionally")
- Verifica que no haya repetición excesiva de la keyword (keyword stuffing)
- Chequea que el tono matchee el style guide

### Paso 5: Publicación
- Claude commitea el .md a GitHub
- Cloudflare Pages detecta el nuevo commit
- Auto-build y deploy en ~60 segundos
- El post está live

---

## 6. ANTI AI-SLOP: CÓMO HACER QUE NO SUENE A ROBOT

Esta es la parte más crítica. El contenido tiene que sonar a persona real, no a ChatGPT.

### El Voice Bank (grabarte una vez)
Grabarte hablando libremente sobre estos temas (total ~2-3 horas, una sola vez):

**Bloque 1: Skincare opinions (45-60 min)**
- ¿Cuál es tu filosofía general de skincare? ¿Menos es más o rutina completa?
- ¿Qué ingredientes activos te parecen realmente buenos y cuáles son puro hype?
- ¿Qué opinás del retinol? ¿Y de la niacinamida? ¿Vitamina C?
- ¿Cuáles son los errores más comunes que ves en gente que empieza con skincare?
- ¿Qué marcas te parecen buenas por su precio? ¿Cuáles son puro marketing?
- ¿Qué pensás del movimiento "clean beauty"? ¿Y "skinimalism"?
- ¿Protector solar: qué tipo preferís y por qué?
- ¿Skincare para hombres: es diferente o es marketing?
- ¿Qué opinas de los dermatólogos en TikTok/YouTube?
- Tus hot takes más controversiales sobre skincare

**Bloque 2: Beauty ecommerce opinions (30-45 min)**
- ¿Qué hace que una marca de beauty tenga éxito online?
- ¿Qué errores ves en las tiendas de skincare online?
- ¿Qué plataformas son mejores para vender beauty products? (Shopify, etc)
- ¿El modelo DTC (direct to consumer) vs marketplace?
- ¿Cómo ves el futuro del ecommerce beauty?
- ¿Qué rol juega el contenido (blogs, reels, TikTok) en vender skincare?
- ¿Influencer marketing en beauty: funciona o es tirar plata?

**Bloque 3: Tu voz y personalidad (15-20 min)**
- Contá una anécdota de cuándo empezaste con skincare
- ¿Qué te apasiona de esto?
- ¿Cuál es tu producto favorito de todos los tiempos y por qué?
- Algo que te de bronca de la industria beauty
- Un consejo que le darías a alguien que recién arranca

**Cómo grabarte:**
- Usá Super Whisper, la app de grabación del Mac, o cualquier cosa que grabe audio
- Hablá como si le estuvieras explicando a un amigo, casual
- No te preocupes por ser perfecto, la idea es capturar TU voz real
- Transcribí con Whisper (gratis) o con la transcripción de Claude

### Style Guide (ver sección 7 abajo)

### AI Slop Detector
El módulo de SEO Machine incluye detección automática de patrones robóticos. Configurarlo para:

**Eliminar automáticamente:**
- "In today's world/age/landscape"
- "It's worth noting/mentioning that"
- "Let's dive in/dive deep"
- "Without further ado"
- "At the end of the day"
- "Game-changer" / "Revolutionary" / "Groundbreaking"
- Uso excesivo de "Furthermore" / "Moreover" / "Additionally"
- Listas que empiezan con "Firstly, Secondly, Thirdly"
- Emojis excesivos o en posiciones robóticas

**Reemplazar con patrones humanos:**
- Frases cortas y directas
- Opiniones con "I think" / "In my experience" / "Honestly"
- Referencias a experiencias reales (del voice bank)
- Humor casual donde tenga sentido
- Preguntas retóricas naturales

---

## 7. STYLE GUIDE — "GLOW INTEL"

### Voz y tono
- **Knowledgeable pero accesible** — como un amigo que sabe mucho de skincare, no un paper científico
- **Opinionated** — tenemos opiniones y las decimos. No somos un wiki neutral.
- **Directo** — vamos al punto. Si un producto no sirve, lo decimos.
- **Ligeramente informal** — contracciones (don't, it's, you'll), preguntas directas al lector
- **Nunca condescendiente** — no asumimos que el lector es tonto

### Estructura de posts
- **Título**: Directo, con la keyword, sin clickbait barato. Ej: "Niacinamide vs Vitamin C: Which Goes First (And Does It Even Matter?)"
- **Intro**: 2-3 oraciones máximo. Ir al grano. Decirle al lector exactamente qué va a encontrar.
- **Cuerpo**: H2s claros, párrafos cortos (3-4 oraciones máx), listas solo cuando realmente ayudan
- **Largo**: 1500-2500 palabras dependiendo del topic. No rellenar.
- **Conclusión**: Breve, actionable. "If you take away one thing from this..." style.

### Cosas que NUNCA hacer
- No empezar con "In today's [whatever]..."
- No usar "dive deep" / "deep dive"
- No decir "game-changer" ni "revolutionary"
- No hacer intros de 3 párrafos antes de ir al punto
- No poner disclaimers innecesarios ("This is not medical advice" en CADA post)
- No usar más de 2 emojis por post (idealmente cero)
- No escribir como Wikipedia ni como textbook
- No repetir la keyword de forma antinatural
- No usar em-dashes en exceso (—)

### Cosas que SÍ hacer
- Ser específico: "The Ordinary's Niacinamide 10% + Zinc 1%" en vez de "a niacinamide serum"
- Incluir precios reales y links cuando se mencionan productos
- Usar datos y estudios cuando estén disponibles (citar fuente)
- Mencionar experiencia personal cuando sea relevante
- Incluir "the catch" — ser honesto sobre limitaciones de productos/ingredientes
- Hacer comparaciones directas ("X is better than Y if you have oily skin because...")
- Usar subheadings como preguntas que el lector tendría

### Categorías del blog
1. **Ingredients** — deep dives en ingredientes (retinol, niacinamide, HA, etc)
2. **Routines** — rutinas por tipo de piel, edad, concern
3. **Reviews** — productos específicos, honestos
4. **Versus** — comparaciones directas (Ingrediente A vs B, Marca A vs B)
5. **Beauty Business** — ecommerce beauty, empezar una marca, tendencias
6. **Beginner Guides** — contenido 101 para gente que recién arranca

### SEO guidelines
- Keyword en el title, H1, primer párrafo, meta description, y URL slug
- Meta description: 150-160 chars, incluir keyword, ser compelling
- Alt text descriptivo en todas las imágenes
- Internal links: mínimo 2-3 links a otros posts del blog por artículo
- External links: mínimo 1-2 links a fuentes autoritativas (studies, dermatologists)
- URL structure: /blog/keyword-phrase (lowercase, hyphens)

---

## 8. PLAN DE EJECUCIÓN — FASES

### FASE 1: Setup del sitio (1-2 sesiones de Claude Code, ~2-4 horas)
**Lo que Claude Code va a hacer por vos:**
1. Crear el proyecto Astro desde cero
2. Instalar dependencias (Tailwind, etc)
3. Crear la estructura de páginas y componentes
4. Elegir/adaptar un theme limpio y moderno para blog
5. Configurar SEO (sitemap, RSS, schema markup, meta tags)
6. Setup de Cloudflare Pages (vos vas a necesitar crear la cuenta)
7. Conectar GitHub repo con Cloudflare
8. Deploy inicial
9. Instalar las skills de SEO

**Lo que VOS tenés que hacer:**
- Crear cuenta en GitHub (si no tenés)
- Crear cuenta en Cloudflare (gratis)
- Comprar un dominio
- Instalar Claude Code en tu Mac (npm install -g @anthropic-ai/claude-code)

### FASE 2: Contenido inicial (semanas 1-4)
**Meta: 15-20 posts publicados, TODO revisado por vos**
- Semana 1-2: Hacer el brain dump (grabarte). Claude transcribe.
- Claude hace keyword research para los primeros 20 posts
- Claude escribe 1 post por día, vos lo revisás y aprobás
- Ir calibrando los prompts hasta que el output sea consistente
- Objetivo: que para la semana 4, el 80% de lo que Claude escribe esté bien de primera

### FASE 3: Semi-automatización (semanas 5-8)
**Meta: Claude escribe, vos revisás solo lo necesario**
- Implementar el content pipeline (scripts automatizados)
- Configurar GitHub Actions para schedule automático
- Reducir tu intervención a 15-30 min/semana
- Conectar Google Search Console y empezar a trackear

### FASE 4: Full autopilot (mes 3+)
**Meta: El blog corre solo, vos mirás métricas**
- 3-4 posts/semana publicados automáticamente
- Revisión quincenal de métricas en GSC
- Ajuste de estrategia de keywords basado en data real
- Cuando llegues a ~10K sessions/mes: aplicar a Mediavine o AdThrive

---

## 9. PRIMER PROMPT PARA CLAUDE CODE

Cuando abras Claude Code por primera vez para este proyecto, pegale esto:

```
Leé el archivo project-brief.md en este directorio. Es el brief completo del proyecto.

Necesito que me ayudes a construir un blog en Astro deployado en Cloudflare Pages. El blog se llama "Glow Intel" (o el nombre que elijamos) y es sobre skincare, beauty y beauty ecommerce, en inglés.

NO sé código. Todo lo vas a hacer vos. Yo solo voy a aprobar, revisar, y darte feedback.

Empecemos por la Fase 1:
1. Creá el proyecto Astro con un theme/template limpio y moderno para blog
2. Configurá Tailwind CSS
3. Creá la estructura de páginas: home, blog listing, post page, about, categories
4. Implementá SEO completo: sitemap, RSS feed, schema markup, Open Graph tags
5. Creá un post de ejemplo para testear
6. Decime paso a paso qué tengo que hacer yo para crear las cuentas de GitHub y Cloudflare y conectar todo

Una vez que el sitio esté live, pasamos a instalar las skills de SEO y armar el content pipeline.
```

---

## 10. RECURSOS Y LINKS

### Repos para instalar
- SEO Machine: https://github.com/TheCraigHewitt/seomachine
- Claude SEO: https://github.com/AgriciDaniel/claude-seo
- SEO+GEO Skills: https://github.com/aaron-he-zhu/seo-geo-claude-skills
- Marketing Skills: https://github.com/coreyhaines31/marketingskills

### Referencia (blogs que ya hacen esto con IA)
- HowDoIUseAI.com — Blog 100% automatizado con Claude + GitHub Actions + Vercel
- Artículo de cómo lo construyeron: https://www.nocodelife.com/how-we-built-howdoiuseai/

### Herramientas gratuitas de keyword research
- Google Search autocomplete (scrapeable con scripts)
- Google "People Also Ask" (scrapeable)
- AnswerThePublic (limitado gratis)
- Google Keyword Planner (gratis con cuenta de Google Ads)
- Ubersuggest (limitado gratis)
- AlsoAsked.com (3 búsquedas gratis/día)

### Documentación técnica
- Astro docs: https://docs.astro.build
- Cloudflare Pages: https://developers.cloudflare.com/pages/
- GitHub Actions cron: https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule
