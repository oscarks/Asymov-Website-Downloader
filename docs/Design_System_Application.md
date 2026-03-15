# Design System Extractor — Documento de Arquitetura

## 1. Visao Geral

Evolucao do Website Downloader para uma plataforma completa de **Vibe Design**: download de sites de referencia, extracao automatizada de Design Systems via LLM, e visualizacao comparativa dos resultados.

**Workflow principal:**
```
URL do site -> Download (Playwright) -> Unzip no workspace -> LLM extrai Design System -> Visualizacao lado a lado
```

---

## 2. Casos de Uso

| # | Caso de Uso | Descricao |
|---|------------|-----------|
| UC1 | Download do site | Captura o site via Playwright (funcionalidade atual), gera ZIP |
| UC2 | Persistencia no workspace | Descompacta ZIP em subdiretorio do workspace (configurado via `.env`). Nomes unicos para evitar colisao |
| UC3 | Extracao do Design System | Envia o HTML + CSS do site para uma LLM com o prompt de extracao. LLM gera `design-system.html` |
| UC4 | Versionamento do Design System | Salva com nome unico: `design-system_{llm}_{versao}.html` na pasta do site |
| UC5 | Visualizacao | File explorer + preview do site original e design systems gerados |
| UC6 | Configuracao | Selecao de LLM provider, API keys, diretorio de trabalho |

---

## 3. Analise: LangChain + LangGraph

### 3.1 Viabilidade

**LangChain** e adequado para este caso por:
- **Abstrai provedores de LLM**: interface unificada `ChatOpenAI`, `ChatAnthropic`, `ChatGoogleGenerativeAI`, etc. Trocar de provedor e trocar uma classe
- **Prompt templates**: permite montar o prompt de extracao com variaveis (path do HTML, conteudo CSS) sem risco de prompt injection
- **Output parsers**: facilita extrair o HTML gerado da resposta do modelo

**LangGraph** e adequado pois o workflow tem etapas encadeadas com decisoes:
```
download -> unzip -> ler_html -> ler_css -> montar_prompt -> chamar_llm -> salvar_resultado
```

Um grafo simples e linear, sem loops complexos, mas LangGraph da:
- Persistencia de estado entre etapas
- Retry com backoff em caso de falha na LLM
- Possibilidade futura de adicionar etapas (ex: validacao do HTML gerado, re-prompting)

### 3.2 Adequacao

| Criterio | Avaliacao |
|----------|-----------|
| Multi-provider LLM | Excelente — LangChain suporta OpenAI, Anthropic, Google, e outros via `langchain-community` |
| Prompt management | Bom — `ChatPromptTemplate` separa system/user messages e injeta variaveis de forma segura |
| Workflow orquestrado | Bom — LangGraph modela o pipeline como grafo de estados |
| Overhead | Aceitavel — adiciona dependencias, mas o ganho em abstracoes justifica |
| Alternativa sem framework | Possivel (chamadas diretas via SDKs), mas perderia a troca facil de provedor |

**Recomendacao**: Usar LangChain para abstracoes de LLM + prompts. Usar LangGraph para orquestrar o pipeline de extracao. Para o download do site, manter a implementacao atual (Playwright) pois nao envolve LLM.

### 3.3 Alternativa considerada

Usar diretamente os SDKs (`openai`, `anthropic`, `google-generativeai`) seria mais leve, mas:
- Cada provedor tem API diferente — codigo de integracao duplicado
- Trocar de provedor exigiria refatoracao
- LangChain resolve isso com ~3 linhas de mudanca

---

## 4. Provedores de LLM — Conexao

### 4.1 Via API Key (recomendado para v1)

| Provedor | Pacote LangChain | Variavel de ambiente | Modelos recomendados |
|----------|-------------------|---------------------|---------------------|
| OpenAI | `langchain-openai` | `OPENAI_API_KEY` | `gpt-4o`, `gpt-4o-mini` |
| Anthropic (Claude) | `langchain-anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-20250514`, `claude-opus-4-20250514` |
| Google (Gemini) | `langchain-google-genai` | `GOOGLE_API_KEY` | `gemini-2.5-pro`, `gemini-2.5-flash` |
| OpenAI-compatible (Codex, Groq, etc.) | `langchain-openai` | `OPENAI_API_BASE` + `OPENAI_API_KEY` | Qualquer modelo compativel |

**Implementacao**: API Keys armazenadas no `.env` e configuraveis pela UI. A aplicacao carrega via `python-dotenv`.

### 4.2 Via OAuth (futuro)

- Google Cloud OAuth para Vertex AI (Gemini) — mais complexo, requer fluxo de autorizacao
- Nao recomendado para v1 pela complexidade adicional
- Pode ser adicionado posteriormente como opcao alternativa de autenticacao

### 4.3 Factory Pattern para LLMs

```python
# Pseudocodigo da abstracão
def get_llm(provider: str, model: str, api_key: str) -> BaseChatModel:
    match provider:
        case "openai":
            return ChatOpenAI(model=model, api_key=api_key)
        case "anthropic":
            return ChatAnthropic(model=model, api_key=api_key)
        case "google":
            return ChatGoogleGenerativeAI(model=model, api_key=api_key)
        case "openai-compatible":
            return ChatOpenAI(model=model, api_key=api_key, base_url=base_url)
```

---

## 5. Arquitetura da Aplicacao

### 5.1 Estrutura de Diretórios (proposta)

```
Website-Downloader/
├── app.py                    # Flask server (rotas e SSE)
├── downloader.py             # WebsiteDownloader (inalterado)
├── extractor.py              # Pipeline LangGraph de extracao do Design System
├── llm_factory.py            # Factory para instanciar LLMs via LangChain
├── workspace.py              # Gerenciamento do workspace (unzip, listagem, nomes)
├── config.py                 # Configuracoes (.env, defaults)
├── templates/
│   └── index.html            # SPA com novo layout
├── static/
│   ├── css/
│   │   └── app.css           # Estilos da aplicacao
│   └── js/
│       └── app.js            # Logica do frontend
├── docs/
│   └── referencias/
│       ├── Fundamentos_Vibe_Design.pdf
│       └── Prompt_Extract_Design_System.md
├── .env.example              # Template de configuracao
├── pyproject.toml
└── Dockerfile
```

### 5.2 Backend — Novos Modulos

#### `config.py`
```python
# Carrega .env e expoe configuracoes
WORKSPACE_DIR = os.getenv("WORKSPACE_DIR", "./workspace")
DEFAULT_LLM_PROVIDER = os.getenv("DEFAULT_LLM_PROVIDER", "openai")
DEFAULT_LLM_MODEL = os.getenv("DEFAULT_LLM_MODEL", "gpt-4o")
```

#### `workspace.py`
- `create_site_folder(url) -> path`: cria subdiretorio com nome baseado no dominio + timestamp se necessario para evitar duplicatas
- `unzip_to_workspace(zip_path, url) -> folder_path`: descompacta e retorna caminho
- `list_sites() -> list[dict]`: lista sites no workspace com metadados
- `list_design_systems(site_folder) -> list[dict]`: lista design systems gerados para um site
- `get_site_files(site_folder) -> dict`: retorna arvore de arquivos

#### `extractor.py` — Pipeline LangGraph

```
Grafo de estados:
  [load_html] -> [load_css] -> [build_prompt] -> [call_llm] -> [save_result]
```

Cada no do grafo:
1. **load_html**: Le `index.html` do site baixado
2. **load_css**: Le todos os CSS referenciados (da pasta `assets/`)
3. **build_prompt**: Monta o prompt usando o template de `Prompt_Extract_Design_System.md`, substituindo `$ARGUMENTS` pelo conteudo HTML. Os CSS sao passados como contexto adicional
4. **call_llm**: Invoca a LLM selecionada via LangChain
5. **save_result**: Extrai o HTML da resposta e salva como `design-system_{provider}_{model}_{timestamp}.html`

**Protecao contra prompt injection**: O conteudo do `Prompt_Extract_Design_System.md` e usado como **system prompt** ou template fixo. O HTML do site e injetado apenas na variavel `$ARGUMENTS`, dentro de um bloco delimitado. O usuario nao tem controle sobre o prompt base.

#### `llm_factory.py`
- Factory pattern conforme secao 4.3
- Validacao de API key antes de iniciar extracao
- Lista de modelos disponiveis por provedor

### 5.3 Backend — Novas Rotas (`app.py`)

| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/` | SPA principal |
| POST | `/api/download` | Inicia download do site (existente, adaptado) |
| GET | `/api/download/stream/<id>` | SSE do progresso do download (existente) |
| POST | `/api/extract` | Inicia extracao do Design System para um site |
| GET | `/api/extract/stream/<id>` | SSE do progresso da extracao |
| GET | `/api/workspace` | Lista sites no workspace |
| GET | `/api/workspace/<site>/files` | Arvore de arquivos de um site |
| GET | `/api/workspace/<site>/preview` | Serve o `index.html` do site para iframe |
| GET | `/api/workspace/<site>/design-systems` | Lista design systems gerados |
| GET | `/api/workspace/<site>/design-system/<filename>` | Serve um design system para iframe |
| GET | `/api/config` | Retorna configuracoes atuais (sem API keys) |
| POST | `/api/config` | Atualiza configuracoes (provider, model, API key) |
| GET | `/api/providers` | Lista provedores e modelos disponiveis |

### 5.4 Configuracao persistente

As configuracoes do usuario (provider, modelo, API keys) serao armazenadas em um arquivo `config.json` no workspace ou em `.env`. As API keys sao armazenadas apenas no servidor (nunca enviadas ao frontend apos salvas — apenas um indicador `configured: true/false`).

---

## 6. Frontend — Layout e UI

### 6.1 Estrutura da Interface

```
┌──────────────────────────────────────────────────────────────────┐
│  [Logo] Vibe Design Extractor    [Download] [Extrair DS] [Config]│  <- Top bar
├──────────────┬───────────────────────────────────────────────────┤
│              │  [Site Original]  [Design System v1] [DS v2]  ... │  <- Tabs
│  workspace/  │ ┌───────────────────────────────────────────────┐ │
│  ├── site-1/ │ │                                               │ │
│  │   ├── ..  │ │         iframe: preview do conteudo           │ │
│  ├── site-2/ │ │                                               │ │
│  │   ├── ..  │ │                                               │ │
│  └── site-3/ │ │                                               │ │
│              │ └───────────────────────────────────────────────┘ │
│  File        │                                                   │
│  Explorer    │  [Select DS version: v1 ▼]  (quando multiplos)   │
│              │                                                   │
└──────────────┴───────────────────────────────────────────────────┘
```

### 6.2 Top Bar (navbar)

- **Logo/Titulo**: "Vibe Design Extractor"
- **Botao Download**: Abre modal com input de URL, inicia download com progresso via SSE
- **Botao Extrair Design System**: Ativo quando um site esta selecionado. Abre modal para selecionar provider/modelo, inicia extracao com progresso via SSE
- **Botao Configuracao (engrenagem)**: Abre modal/painel de configuracoes (providers, API keys, workspace path)

### 6.3 Coluna Esquerda — File Explorer

- Arvore de diretorios do workspace
- Primeiro nivel: pastas dos sites (nome do dominio)
- Clique em uma pasta: seleciona o site e carrega preview na coluna direita
- Icone indicador de quantos design systems foram gerados para cada site
- Estilo minimalista, similar a VS Code sidebar

### 6.4 Coluna Direita — Preview

**Modo 1: Aba unica (padrao)**
- Abas na parte superior: "Site Original" | "Design System"
- Ao selecionar "Design System", exibe o iframe do design system
- Quando existem multiplos design systems, um `<select>` permite escolher qual visualizar (ex: `claude-sonnet_v1`, `gpt-4o_v2`)

**Modo 2: Split view**
- Tela dividida verticalmente (50/50)
- Parte superior: site original (iframe)
- Parte inferior: design system selecionado (iframe)
- Toggle na toolbar para alternar entre modos
- O select de versao do design system aparece sobre o iframe inferior

### 6.5 Modais

**Modal de Download:**
- Input de URL
- Botao "Baixar"
- Area de log com progresso (SSE) — reutiliza o pattern atual
- Ao concluir, atualiza o file explorer automaticamente

**Modal de Extracao:**
- Dropdown de LLM provider
- Dropdown de modelo
- Preview do site selecionado (nome)
- Botao "Extrair Design System"
- Area de log com progresso (SSE)
- Ao concluir, adiciona nova aba/opcao no select de design systems

**Modal de Configuracao:**
- Secao por provedor (OpenAI, Anthropic, Google, Custom)
- Input de API Key (type=password) com botao "Testar conexao"
- Input do diretorio de workspace
- Selecao de provedor/modelo padrao
- Botao salvar

### 6.6 Tecnologias Frontend

- **HTML/CSS/JS vanilla** — sem framework (mantendo o padrao atual do projeto)
- CSS custom properties para tema (dark mode clean)
- Layout com CSS Grid (sidebar + main area)
- Iframes para preview dos sites e design systems
- SSE via `EventSource` (pattern existente)

---

## 7. Fluxo de Dados

### 7.1 Download + Workspace

```
1. Usuario insere URL no modal de download
2. POST /api/download {url}
3. Backend inicia WebsiteDownloader em thread (existente)
4. Progresso via SSE /api/download/stream/<id>
5. Ao concluir:
   a. workspace.unzip_to_workspace(zip_path, url) -> site_folder
   b. Remove ZIP temporario
   c. Envia evento SSE "done"
6. Frontend atualiza file explorer via GET /api/workspace
```

### 7.2 Extracao do Design System

```
1. Usuario seleciona site no explorer e clica "Extrair DS"
2. Escolhe provider/modelo no modal
3. POST /api/extract {site_folder, provider, model}
4. Backend inicia pipeline LangGraph em thread:
   a. Le index.html do site
   b. Le CSS da pasta assets/
   c. Monta prompt (template + HTML como $ARGUMENTS)
   d. Chama LLM via LangChain
   e. Extrai HTML da resposta
   f. Salva como design-system_{provider}_{model}_{timestamp}.html
5. Progresso via SSE /api/extract/stream/<id>
6. Frontend atualiza lista de design systems
```

### 7.3 Montagem do Prompt (detalhe critico)

O prompt de `Prompt_Extract_Design_System.md` define a variavel `$ARGUMENTS` como referencia ao HTML de entrada. A montagem:

```python
# extractor.py (pseudocodigo)
prompt_template = load_file("docs/referencias/Prompt_Extract_Design_System.md")

# $ARGUMENTS e substituido pelo caminho/conteudo do HTML
# O HTML do site e passado como contexto, NAO como instrucao
system_message = prompt_template.replace("$ARGUMENTS", "the HTML content provided below")

user_message = f"""
Here is the reference HTML file content:

```html
{html_content}
```

And here are the CSS files used:

{css_contents}
"""

# Envio para LLM via LangChain
messages = [
    SystemMessage(content=system_message),
    HumanMessage(content=user_message)
]
response = llm.invoke(messages)
```

**Nota sobre prompt injection**: O conteudo HTML do site baixado e tratado como **dados**, nao como instrucoes. O system prompt e fixo e vem do template. Mesmo que o HTML contenha texto que tente manipular a LLM, o system prompt estabelece o papel e as regras de forma rigida.

---

## 8. Nomeacao dos Arquivos de Design System

Formato: `design-system_{provider}_{model}_{YYYYMMDD-HHmmss}.html`

Exemplos:
- `design-system_anthropic_claude-sonnet_20260314-143022.html`
- `design-system_openai_gpt-4o_20260314-150511.html`
- `design-system_google_gemini-2.5-pro_20260314-161033.html`

Isso permite:
- Identificar qual LLM gerou cada versao
- Ordenar cronologicamente
- Comparar resultados entre provedores
- Nunca sobrescrever versoes anteriores

---

## 9. Dependencias Adicionais

```toml
# Adicoes ao pyproject.toml
dependencies = [
    # Existentes
    "beautifulsoup4>=4.14.3",
    "flask>=3.1.2",
    "playwright>=1.57.0",
    "requests>=2.32.5",
    # Novas
    "langchain-core>=0.3",
    "langchain-openai>=0.3",
    "langchain-anthropic>=0.3",
    "langchain-google-genai>=2.1",
    "langgraph>=0.4",
    "python-dotenv>=1.1",
]
```

---

## 10. Exemplo de `.env`

```env
# Workspace
WORKSPACE_DIR=./workspace

# LLM Defaults
DEFAULT_LLM_PROVIDER=anthropic
DEFAULT_LLM_MODEL=claude-sonnet-4-20250514

# API Keys (configurar pelo menos um)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=AI...

# OpenAI-compatible (opcional)
CUSTOM_LLM_BASE_URL=
CUSTOM_LLM_API_KEY=
CUSTOM_LLM_MODEL=
```

---

## 11. Plano de Implementacao (fases sugeridas)

### Fase 1 — Workspace e Backend
1. Criar `config.py` com carregamento do `.env`
2. Criar `workspace.py` (unzip, listagem, nomes unicos)
3. Adaptar `app.py`: download salva no workspace ao inves de servir ZIP
4. Novas rotas de API para workspace

### Fase 2 — Integracao LLM
5. Criar `llm_factory.py` com factory pattern
6. Criar `extractor.py` com pipeline LangGraph
7. Rotas de extracao com SSE
8. Rota de configuracao

### Fase 3 — Frontend
9. Novo layout com sidebar + preview area
10. File explorer com listagem do workspace
11. Sistema de abas e split view
12. Modais de download, extracao e configuracao
13. Integracao SSE para ambos os fluxos

### Fase 4 — Polish
14. Validacao de API keys (botao "testar conexao")
15. Tratamento de erros e feedback visual
16. Responsividade basica
17. Atualizacao do Dockerfile e docker-compose

---

## 12. Consideracoes Tecnicas

### Context Window
O HTML de um site pode ser grande (50k-200k tokens). Modelos com contexto grande sao preferidos:
- Claude Sonnet/Opus: 200k tokens
- GPT-4o: 128k tokens
- Gemini 2.5 Pro: 1M tokens

O pipeline deve estimar tokens antes de enviar e avisar o usuario se o site for muito grande para o modelo selecionado.

### Rate Limits e Custos
- Cada extracao e uma unica chamada de LLM (nao streaming obrigatorio)
- Custo estimado por extracao: $0.05-0.50 dependendo do tamanho e modelo
- A UI deve exibir estimativa de custo antes de confirmar

### Servindo Previews via Iframe
Os sites baixados referenciam assets com caminhos relativos (`assets/style.css`). Para que os iframes funcionem, o Flask precisa servir a pasta do site como diretorio estatico. A rota `/api/workspace/<site>/preview` servira o `index.html` e uma rota catch-all servira os assets relativos.

### Design System como HTML
O design system gerado e um HTML que referencia os **mesmos CSS** do site original (na pasta `assets/`). Como esta na mesma pasta, os caminhos relativos funcionam automaticamente.
