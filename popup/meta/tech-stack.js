const TECH_PATTERNS = [
  ['JavaScript', '\\bJavaScript\\b', 'i'],
  ['TypeScript', '\\bTypeScript\\b', 'i'],
  ['Python',     '\\bPython\\b', 'i'],
  ['Java',       '\\bJava\\b(?!Script)', 'i'],
  ['Kotlin',     '\\bKotlin\\b', 'i'],
  ['Swift',      '\\bSwift\\b', 'i'],
  ['Go',         '\\bGo(?:lang)?\\b', 'i'],
  ['Rust',       '\\bRust\\b', 'i'],
  ['Ruby',       '\\bRuby\\b', 'i'],
  ['PHP',        '\\bPHP\\b', ''],
  ['C#',         '\\bC#', ''],
  ['C++',        '\\bC\\+\\+', ''],
  ['Scala',      '\\bScala\\b', 'i'],
  ['Dart',       '\\bDart\\b', 'i'],
  ['Elixir',     '\\bElixir\\b', 'i'],
  ['Groovy',     '\\bGroovy\\b', 'i'],
  ['Perl',       '\\bPerl\\b', 'i'],
  ['Bash',       '\\bBash\\b|\\bShell\\s+script', 'i'],
  ['PowerShell', '\\bPowerShell\\b', 'i'],
  ['React',      '\\bReact(?:\\.js)?\\b', 'i'],
  ['Angular',    '\\bAngular(?:JS)?\\b', 'i'],
  ['Vue',        '\\bVue(?:\\.js)?\\b', 'i'],
  ['Svelte',     '\\bSvelte\\b', 'i'],
  ['Next.js',    '\\bNext\\.js\\b', 'i'],
  ['Nuxt',       '\\bNuxt(?:\\.js)?\\b', 'i'],
  ['Redux',      '\\bRedux\\b', 'i'],
  ['GraphQL',    '\\bGraphQL\\b', 'i'],
  ['jQuery',     '\\bjQuery\\b', 'i'],
  ['HTML',       '\\bHTML5?\\b', 'i'],
  ['CSS',        '\\bCSS3?\\b', 'i'],
  ['SCSS',       '\\bSCSS\\b', 'i'],
  ['Tailwind',   '\\bTailwind(?:\\s*CSS)?\\b', 'i'],
  ['Bootstrap',  '\\bBootstrap\\b', 'i'],
  ['Webpack',    '\\bWebpack\\b', 'i'],
  ['Vite',       '\\bVite\\b', 'i'],
  ['Node.js',    '\\bNode(?:\\.js)?\\b', 'i'],
  ['Node',       '\\bNode\\b', 'i'],
  ['NodeJS',     '\\bNodeJS\\b', 'i'],
  ['Express',    '\\bExpress(?:\\.js)?\\b', 'i'],
  ['Django',     '\\bDjango\\b', 'i'],
  ['Flask',      '\\bFlask\\b', 'i'],
  ['FastAPI',    '\\bFastAPI\\b', 'i'],
  ['Spring Boot','\\bSpring\\s*Boot\\b', 'i'],
  ['Spring',     '\\bSpring\\b(?!\\s*Boot)', 'i'],
  ['Rails',      '\\bRails\\b|\\bRuby on Rails\\b', 'i'],
  ['Laravel',    '\\bLaravel\\b', 'i'],
  ['NestJS',     '\\bNest(?:JS|\\.js)?\\b', 'i'],
  ['.NET',       '\\.NET\\b', 'i'],
  ['gRPC',       '\\bgRPC\\b', 'i'],
  ['REST API',   '\\bREST(?:ful)?\\s*API\\b', 'i'],
  ['PostgreSQL', '\\bPostgres(?:QL)?\\b', 'i'],
  ['MySQL',      '\\bMySQL\\b', 'i'],
  ['MongoDB',    '\\bMongoDB\\b', 'i'],
  ['Redis',      '\\bRedis\\b', 'i'],
  ['Elasticsearch', '\\bElasticsearch\\b', 'i'],
  ['DynamoDB',   '\\bDynamoDB\\b', 'i'],
  ['Cassandra',  '\\bCassandra\\b', 'i'],
  ['SQLite',     '\\bSQLite\\b', 'i'],
  ['SQL Server', '\\bSQL\\s+Server\\b', 'i'],
  ['BigQuery',   '\\bBigQuery\\b', 'i'],
  ['Snowflake',  '\\bSnowflake\\b', 'i'],
  ['Redshift',   '\\bRedshift\\b', 'i'],
  ['Oracle DB',  '\\bOracle\\s+DB\\b|\\bOracle\\s+Database\\b', 'i'],
  ['SQL',        '\\bSQL\\b(?!\\s+Server)', ''],
  ['NoSQL',      '\\bNoSQL\\b', 'i'],
  ['AWS',        '\\bAWS\\b', ''],
  ['GCP',        '\\bGCP\\b|\\bGoogle\\s+Cloud\\b', 'i'],
  ['Azure',      '\\bAzure\\b', 'i'],
  ['Kubernetes', '\\bKubernetes\\b|\\bk8s\\b', 'i'],
  ['Docker',     '\\bDocker\\b', 'i'],
  ['Terraform',  '\\bTerraform\\b', 'i'],
  ['Ansible',    '\\bAnsible\\b', 'i'],
  ['Helm',       '\\bHelm\\b', 'i'],
  ['Kafka',      '\\bKafka\\b', 'i'],
  ['RabbitMQ',   '\\bRabbitMQ\\b', 'i'],
  ['Spark',      '\\bApache\\s+Spark\\b|\\bPySpark\\b', 'i'],
  ['Airflow',    '\\bAirflow\\b', 'i'],
  ['CI/CD',      '\\bCI\/CD\\b', 'i'],
  ['Jenkins',    '\\bJenkins\\b', 'i'],
  ['GitHub Actions', '\\bGitHub\\s+Actions\\b', 'i'],
  ['GitLab CI',  '\\bGitLab\\s+CI\\b', 'i'],
  ['Prometheus', '\\bPrometheus\\b', 'i'],
  ['Grafana',    '\\bGrafana\\b', 'i'],
  ['Datadog',    '\\bDatadog\\b', 'i'],
  ['Jest',       '\\bJest\\b', 'i'],
  ['Vitest',     '\\bVitest\\b', 'i'],
  ['Pytest',     '\\bPytest\\b', 'i'],
  ['JUnit',      '\\bJUnit\\b', 'i'],
  ['Cypress',    '\\bCypress\\b', 'i'],
  ['Selenium',   '\\bSelenium\\b', 'i'],
  ['Playwright', '\\bPlaywright\\b', 'i'],
  ['Mocha',      '\\bMocha\\b', 'i'],
  ['TensorFlow', '\\bTensorFlow\\b', 'i'],
  ['PyTorch',    '\\bPyTorch\\b', 'i'],
  ['scikit-learn','\\bscikit[-\\s]learn\\b', 'i'],
  ['Pandas',     '\\bPandas\\b', 'i'],
  ['NumPy',      '\\bNumPy\\b', 'i'],
  ['LangChain',  '\\bLangChain\\b', 'i'],
  ['OpenAI',     '\\bOpenAI\\b', 'i'],
];

async function getTechStackFromJobPage(tabId) {
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId },
      func: (patterns) => {
        const pane = document.querySelector(
          '.jobs-search__job-details--wrapper, .scaffold-layout__detail, .job-view-layout, .jobs-details'
        );
        const text = (pane || document.body).innerText || '';
        return patterns
          .filter(([, src, flags]) => new RegExp(src, flags).test(text))
          .map(([label]) => label);
      },
      args: [TECH_PATTERNS]
    });
    return res[0]?.result || [];
  } catch {
    return [];
  }
}

function showTechStack(techList) {
  if (!_onJobPage || !techList || techList.length === 0) {
    techStackEl.style.display = 'none';
    return;
  }
  techStackEl.innerHTML =
    '<span class="tech-label">Tech:</span>' +
    techList.map(t => `<span class="tech-chip">${t}</span>`).join('');
  techStackEl.style.display = 'flex';
}
