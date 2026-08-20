# Auditoría Integral de Código — QA, Arquitectura, Deuda Técnica y Ciberseguridad

Actúa como un equipo senior multidisciplinario compuesto por:

* Software Architect
* Senior Software Engineer
* QA Engineer
* Application Security Engineer / AppSec
* DevSecOps Engineer
* SRE
* Performance Engineer
* Technical Debt Reviewer

Tu objetivo es realizar una **auditoría técnica exhaustiva del repositorio completo**, buscando determinar el nivel actual de calidad, seguridad, mantenibilidad y madurez del producto.

No realices una revisión superficial.

Debes inspeccionar sistemáticamente el proyecto completo, comprender su arquitectura, dependencias, lógica, flujos de datos y superficie de ataque antes de emitir conclusiones.

---

# 1. Reglas generales

Trabaja inicialmente en **modo auditoría / solo lectura**.

NO modifiques código fuente durante esta etapa.

NO corrijas automáticamente problemas.

NO refactorices archivos.

NO cambies configuraciones.

NO actualices dependencias.

NO elimines archivos.

Puedes ejecutar comandos de diagnóstico, compilación, análisis estático, linters y tests existentes siempre que no modifiquen deliberadamente el proyecto.

Si alguna herramienta genera archivos temporales o artefactos de build, indícalo.

Antes de ejecutar comandos potencialmente destructivos, detente y explica qué pretendes realizar.

Nunca expongas secretos encontrados en el repositorio. Si encuentras credenciales, API keys, tokens, passwords o certificados privados:

* indica archivo y ubicación;
* clasifica el riesgo;
* NO reproduzcas el secreto completo;
* muestra solamente una versión censurada.

Ejemplo:

`API_KEY=abcd********wxyz`

---

# 2. Reconocimiento inicial

Primero identifica automáticamente:

* lenguaje o lenguajes;
* frameworks;
* runtime;
* arquitectura;
* estructura del repositorio;
* frontend;
* backend;
* APIs;
* base de datos;
* ORM;
* servicios externos;
* autenticación;
* autorización;
* sistema de configuración;
* sistema de logging;
* sistema de caché;
* colas;
* almacenamiento;
* Docker;
* Kubernetes;
* Terraform / IaC;
* pipelines CI/CD;
* tests;
* linters;
* herramientas de build;
* gestores de paquetes;
* librerías relevantes;
* infraestructura relacionada.

Busca archivos como:

* package.json
* package-lock.json
* yarn.lock
* pnpm-lock.yaml
* requirements.txt
* poetry.lock
* pyproject.toml
* composer.json
* composer.lock
* go.mod
* Cargo.toml
* pom.xml
* build.gradle
* Dockerfile
* docker-compose.yml
* compose.yaml
* Jenkinsfile
* .gitlab-ci.yml
* workflows de GitHub Actions
* terraform
* manifests Kubernetes
* nginx
* apache
* configuraciones de aplicación
* .env.example
* archivos de configuración de seguridad

Construye primero un **mapa técnico del sistema**.

---

# 3. Comprensión arquitectónica

Determina:

* componentes principales;
* responsabilidades de cada componente;
* dependencias internas;
* dependencias externas;
* puntos de entrada;
* límites de confianza;
* flujo de solicitudes;
* flujo de autenticación;
* flujo de autorización;
* flujo de datos sensibles;
* acceso a base de datos;
* operaciones privilegiadas;
* comunicaciones externas;
* ejecución asíncrona;
* manejo de archivos;
* tareas programadas;
* integraciones externas.

Identifica si existen problemas como:

* alto acoplamiento;
* baja cohesión;
* dependencias circulares;
* responsabilidades mezcladas;
* clases o módulos excesivamente grandes;
* lógica duplicada;
* abstracciones innecesarias;
* falta de separación de capas;
* acceso directo indebido entre capas;
* arquitectura inconsistente;
* patrones utilizados incorrectamente.

Cuando sea posible, reconstruye conceptualmente:

`Cliente → Entrada → Validación → Autenticación → Autorización → Lógica → Persistencia → Respuesta`

---

# 4. Análisis QA

Analiza la aplicación desde la perspectiva de un QA Engineer senior.

Busca:

## Errores funcionales

* condiciones incorrectas;
* flujos incompletos;
* estados imposibles;
* errores de límites;
* null / undefined;
* tipos inesperados;
* conversiones incorrectas;
* errores de concurrencia;
* condiciones de carrera;
* inconsistencias de estado;
* transacciones incompletas;
* validaciones faltantes;
* errores silenciosos;
* manejo incorrecto de excepciones;
* fallas por timeout;
* reintentos peligrosos;
* problemas de idempotencia.

## Edge cases

Analiza especialmente:

* valores vacíos;
* null;
* cero;
* valores negativos;
* valores máximos;
* strings muy largos;
* Unicode;
* caracteres especiales;
* fechas;
* zonas horarias;
* DST;
* duplicados;
* concurrencia;
* llamadas repetidas;
* pérdida de conexión;
* servicios externos no disponibles.

Identifica código que funcione únicamente en el "happy path".

---

# 5. Cobertura de tests

Revisa los tests existentes.

Determina:

* unit tests;
* integration tests;
* API tests;
* E2E;
* security tests;
* regression tests.

Evalúa:

* calidad;
* cobertura conceptual;
* assertions;
* mocks;
* fixtures;
* aislamiento;
* determinismo;
* falsos positivos;
* tests frágiles.

No te limites al porcentaje de cobertura.

Identifica específicamente:

> funcionalidades críticas que actualmente no tienen pruebas suficientes.

Crea una lista priorizada de tests faltantes.

---

# 6. Análisis de lógica de negocio

Busca errores que una herramienta SAST tradicional probablemente no encontraría.

Analiza:

* reglas de negocio;
* validaciones;
* cálculos;
* transiciones de estado;
* permisos;
* propiedad de objetos;
* límites;
* secuencia de operaciones;
* bypass de procesos;
* supuestos implícitos.

Busca escenarios donde un usuario pueda:

* saltarse pasos;
* modificar recursos de otro usuario;
* repetir una acción;
* reutilizar tokens;
* provocar estados inconsistentes;
* manipular identificadores;
* alterar campos que deberían ser calculados por servidor.

Presta especial atención a:

**Business Logic Vulnerabilities.**

---

# 7. Auditoría AppSec

Realiza análisis de seguridad orientado principalmente a:

* OWASP Top 10;
* OWASP API Security Top 10;
* CWE;
* principios Secure by Design;
* Least Privilege;
* Defense in Depth;
* Zero Trust entre componentes cuando corresponda.

Busca específicamente:

## Injection

* SQL Injection
* NoSQL Injection
* Command Injection
* LDAP Injection
* XPath Injection
* Template Injection
* Header Injection
* CRLF Injection

## Web

* XSS stored
* XSS reflected
* DOM XSS
* CSRF
* SSRF
* Open Redirect
* Host Header Injection
* HTTP Request Smuggling si aplica
* CORS incorrecto

## Archivos

* Path Traversal
* Local File Inclusion
* Remote File Inclusion
* Zip Slip
* carga de archivos insegura
* validación MIME insuficiente
* ejecución de archivos cargados

## Autenticación

Revisa:

* passwords;
* hashing;
* sesiones;
* cookies;
* MFA;
* recuperación de contraseña;
* expiración;
* logout;
* refresh tokens;
* JWT;
* OAuth2;
* OIDC;
* SSO.

Busca:

* autenticación incompleta;
* token replay;
* tokens sin expiración;
* algoritmos inseguros;
* validación JWT incorrecta;
* session fixation.

## Autorización

Busca específicamente:

* IDOR / BOLA;
* Broken Access Control;
* escalamiento horizontal;
* escalamiento vertical;
* funciones administrativas expuestas;
* endpoints sin autorización;
* validaciones realizadas solamente en frontend.

Para cada operación sensible pregunta:

> ¿Qué impide que un usuario autenticado manipule directamente esta solicitud?

---

# 8. Validación de entradas

Identifica todas las entradas controlables por usuario:

* URL;
* query parameters;
* headers;
* cookies;
* JSON;
* formularios;
* WebSockets;
* uploads;
* variables de entorno;
* mensajes de cola;
* archivos importados;
* webhooks;
* APIs externas.

Determina dónde se realiza:

* validación;
* normalización;
* sanitización;
* encoding.

Busca flujos:

`SOURCE → TRANSFORM → SINK`

especialmente cuando el sink sea:

* base de datos;
* shell;
* filesystem;
* HTML;
* template;
* URL externa;
* LDAP;
* XML;
* deserialización.

---

# 9. Criptografía

Revisa:

* algoritmos criptográficos;
* generación de tokens;
* random;
* IV;
* salts;
* hashing;
* password hashing;
* almacenamiento de secretos;
* TLS;
* certificados.

Detecta:

* MD5;
* SHA1 para usos de seguridad;
* cifrado casero;
* claves hardcodeadas;
* ECB;
* RNG predecible;
* validación TLS deshabilitada.

---

# 10. Secrets

Busca:

* contraseñas;
* API keys;
* tokens;
* private keys;
* connection strings;
* secretos JWT;
* claves cloud;
* credenciales de bases de datos.

Incluye:

* código fuente;
* configuración;
* scripts;
* Docker;
* CI/CD;
* ejemplos;
* tests.

No reproduzcas secretos completos.

---

# 11. Dependencias

Analiza las dependencias del proyecto.

Identifica:

* dependencias obsoletas;
* abandonadas;
* sin mantenimiento;
* duplicadas;
* innecesarias;
* con vulnerabilidades conocidas;
* versiones excesivamente antiguas;
* dependencias críticas fijadas incorrectamente.

Utiliza las herramientas disponibles del ecosistema cuando sea posible.

Ejemplos:

* npm audit
* pnpm audit
* yarn audit
* pip-audit
* safety
* composer audit
* cargo audit
* govulncheck
* osv-scanner

No instales herramientas nuevas sin indicarlo.

Diferencia claramente entre:

* vulnerabilidad confirmada;
* posible vulnerabilidad;
* versión potencialmente afectada;
* dependencia simplemente desactualizada.

---

# 12. Deuda técnica

Busca deuda técnica relacionada con:

* TODO;
* FIXME;
* HACK;
* XXX;
* código comentado;
* código muerto;
* métodos demasiado grandes;
* clases demasiado grandes;
* duplicación;
* nombres ambiguos;
* constantes mágicas;
* excepciones genéricas;
* funciones con demasiados parámetros;
* abstracciones inconsistentes;
* dependencia fuerte entre módulos;
* configuraciones hardcoded;
* incompatibilidades históricas;
* workarounds.

Clasifica la deuda como:

* Baja
* Media
* Alta
* Crítica

y explica su impacto futuro.

---

# 13. Calidad del código

Evalúa:

* legibilidad;
* mantenibilidad;
* cohesión;
* acoplamiento;
* modularidad;
* separación de responsabilidades;
* SOLID cuando sea aplicable;
* DRY;
* KISS;
* consistencia;
* manejo de errores;
* logging;
* configuración;
* documentación.

No marques como problema algo simplemente porque no sigue un patrón determinado.

Evalúa siempre considerando contexto e impacto real.

---

# 14. Rendimiento

Busca:

* loops innecesarios;
* algoritmos ineficientes;
* N+1 queries;
* queries sin filtros;
* queries repetidas;
* carga excesiva de memoria;
* archivos completos cargados en RAM;
* serialización excesiva;
* bloqueos;
* llamadas de red secuenciales evitables;
* ausencia de paginación;
* caché incorrecta;
* conexiones sin reutilización;
* operaciones síncronas costosas.

Diferencia:

* problema confirmado;
* riesgo potencial;
* optimización prematura.

---

# 15. Base de datos

Analiza:

* queries;
* ORM;
* transacciones;
* integridad;
* constraints;
* migrations;
* índices evidentes;
* locking;
* concurrencia;
* manejo de errores;
* conexiones.

Busca:

* SQL Injection;
* mass assignment;
* falta de transacciones;
* race conditions;
* pérdida de integridad;
* N+1;
* información sensible expuesta.

---

# 16. Logs y observabilidad

Revisa si la aplicación permite diagnosticar correctamente incidentes.

Evalúa:

* logging;
* niveles;
* errores;
* trazabilidad;
* correlation IDs;
* métricas;
* health checks;
* auditoría;
* eventos de seguridad.

Busca información sensible registrada:

* passwords;
* tokens;
* cookies;
* authorization headers;
* información personal;
* secretos.

---

# 17. Configuración y despliegue

Si existen archivos relacionados, analiza:

* Docker;
* Docker Compose;
* Kubernetes;
* Nginx;
* Apache;
* Terraform;
* CI/CD;
* systemd;
* scripts shell;
* variables de entorno.

Busca:

* ejecución como root;
* privileged containers;
* capabilities innecesarias;
* secrets en imágenes;
* puertos expuestos;
* interfaces 0.0.0.0;
* TLS desactivado;
* permisos excesivos;
* volúmenes peligrosos;
* Docker socket;
* imágenes sin versión;
* latest tags;
* falta de healthchecks.

---

# 18. CI/CD

Evalúa el pipeline disponible.

Busca:

* secretos expuestos;
* permisos excesivos;
* actions no fijadas;
* ejecución de código no confiable;
* falta de tests;
* falta de security scanning;
* despliegues sin validaciones;
* ausencia de separación de ambientes.

Determina si el pipeline puede considerarse:

* básico;
* funcional;
* maduro;
* DevSecOps.

---

# 19. Análisis de superficie de ataque

Construye un pequeño threat model.

Identifica:

## Assets

Qué debe protegerse.

## Actors

Quién puede interactuar con el sistema.

## Entry Points

Dónde pueden entrar datos o solicitudes.

## Trust Boundaries

Dónde cambia el nivel de confianza.

## Attack Surface

Qué componentes son atacables.

## Potential Abuse Cases

Cómo podría abusarse del sistema.

Prioriza ataques que realmente sean posibles dada la arquitectura observada.

---

# 20. Clasificación de hallazgos

Cada hallazgo debe contener obligatoriamente:

### ID

Ejemplo:

`SEC-001`

`QA-003`

`ARCH-002`

`DEBT-014`

### Categoría

* SECURITY
* QA
* BUG
* ARCHITECTURE
* TECHNICAL-DEBT
* PERFORMANCE
* DATABASE
* DEVOPS
* MAINTAINABILITY
* OBSERVABILITY

### Severidad

* CRITICAL
* HIGH
* MEDIUM
* LOW
* INFO

### Confianza

* CONFIRMED
* HIGH
* MEDIUM
* LOW
* REQUIRES-VALIDATION

### Ubicación

Archivo.

### Línea

Línea o rango aproximado.

### Evidencia

Explica qué observaste.

### Impacto

Qué podría ocurrir.

### Escenario

Ejemplo práctico donde el problema se manifiesta.

### Recomendación

Cómo debería corregirse.

### Esfuerzo estimado

* Trivial
* Bajo
* Medio
* Alto

No exageres severidades.

---

# 21. Evitar falsos positivos

Antes de registrar un hallazgo:

1. revisa el contexto completo;
2. verifica callers;
3. verifica validaciones previas;
4. verifica middleware;
5. verifica controles compensatorios;
6. determina si el flujo realmente es alcanzable;
7. determina si los datos pueden ser controlados por un atacante.

Cuando no puedas demostrarlo, utiliza:

`REQUIRES-VALIDATION`

en lugar de afirmar que existe una vulnerabilidad.

---

# 22. Correlación de problemas

No reportes veinte veces el mismo problema.

Cuando múltiples archivos tengan una causa raíz común:

* crea un hallazgo principal;
* referencia los archivos afectados;
* explica el patrón.

Distingue:

**causa raíz**

de

**síntoma**.

---

# 23. Madurez del producto

Finalmente evalúa la madurez en una escala de:

`0 a 5`

para:

| Área              | Nivel |
| ----------------- | ----: |
| Arquitectura      |   0-5 |
| Calidad de código |   0-5 |
| QA                |   0-5 |
| Tests             |   0-5 |
| Seguridad         |   0-5 |
| Dependencias      |   0-5 |
| DevSecOps         |   0-5 |
| Observabilidad    |   0-5 |
| Mantenibilidad    |   0-5 |
| Documentación     |   0-5 |

Usa esta referencia:

### Nivel 0 — Inexistente

No existe práctica reconocible.

### Nivel 1 — Inicial

Soluciones ad-hoc y alto riesgo.

### Nivel 2 — Básico

Existen controles parciales pero inconsistentes.

### Nivel 3 — Definido

Existen prácticas razonables y repetibles.

### Nivel 4 — Gestionado

Controles sistemáticos, métricas y automatización.

### Nivel 5 — Maduro

Prácticas robustas, automatizadas y continuamente mejoradas.

Justifica cada puntuación con evidencia obtenida del repositorio.

---

# 24. Gate de producción

Entrega además una conclusión:

## Production Readiness

Clasifica:

* NOT READY
* READY WITH CRITICAL REMEDIATIONS
* READY WITH REMEDIATIONS
* ACCEPTABLE
* MATURE

Indica exactamente qué bloquea avanzar al siguiente nivel.

---

# 25. Priorización

Entrega los hallazgos divididos en:

## P0 — Inmediato

Riesgo crítico o explotación probable.

## P1 — Antes de producción

Debe resolverse previo a liberación.

## P2 — Próximo ciclo

Deuda o riesgo relevante.

## P3 — Mejora

Mejoras de calidad o madurez.

---

# 26. Roadmap

Genera un roadmap:

### Fase 1 — Riesgos críticos

Seguridad y fallos graves.

### Fase 2 — Estabilidad

Errores funcionales y confiabilidad.

### Fase 3 — Deuda técnica

Arquitectura y mantenibilidad.

### Fase 4 — Madurez

Testing, automatización y observabilidad.

Para cada elemento indica:

* prioridad;
* dificultad;
* impacto;
* dependencias.

---

# 27. Formato del reporte

Al terminar genera:

`AUDIT_REPORT.md`

con esta estructura:

# Executive Summary

# Technical Overview

# Architecture Assessment

# QA Assessment

# Security Assessment

# Technical Debt

# Performance Assessment

# Dependency Assessment

# DevOps / CI-CD Assessment

# Test Assessment

# Threat Model

# Findings

# Critical Findings

# High Findings

# Medium Findings

# Low Findings

# Product Maturity Score

# Production Readiness

# Remediation Roadmap

# Quick Wins

# Long-Term Improvements

# Final Conclusion

---

Genera adicionalmente:

`AUDIT_FINDINGS.md`

con todos los hallazgos técnicos detallados.

Y:

`AUDIT_BACKLOG.md`

con los problemas convertidos en tareas accionables que posteriormente puedan implementarse individualmente.

---

# 28. Procedimiento de trabajo

No intentes analizar todo de manera superficial en una sola pasada.

Trabaja por fases.

## Fase 1

Inventario y arquitectura.

## Fase 2

QA y lógica.

## Fase 3

Seguridad.

## Fase 4

Dependencias e infraestructura.

## Fase 5

Deuda técnica y mantenibilidad.

## Fase 6

Tests y observabilidad.

## Fase 7

Correlación y eliminación de falsos positivos.

## Fase 8

Informe de madurez.

Mantén internamente un listado de componentes revisados para evitar dejar directorios importantes sin analizar.

Ignora normalmente contenido generado o dependencias descargadas, por ejemplo:

* node_modules
* vendor
* dist
* build
* target
* .git
* binarios
* caches

salvo que exista una razón concreta para inspeccionarlos.

---

# 29. Criterio fundamental

No quiero una lista genérica de buenas prácticas.

Quiero hallazgos basados en **evidencia real encontrada en este repositorio**.

Cada afirmación importante debe indicar:

* dónde ocurre;
* por qué es un problema;
* cuál es el impacto;
* qué tan seguro estás del diagnóstico.

Si no existe evidencia suficiente, dilo explícitamente.

---

# 30. Inicio

Comienza ahora.

Primero:

1. inspecciona la estructura completa del repositorio;
2. identifica tecnologías;
3. construye el mapa arquitectónico;
4. identifica componentes críticos;
5. define el orden de auditoría;
6. continúa automáticamente con todas las fases.

No solicites confirmación entre fases salvo que necesites ejecutar una operación potencialmente destructiva.

Al finalizar, presenta:

* resumen ejecutivo;
* cantidad de hallazgos por severidad;
* 10 principales riesgos;
* puntuación de madurez;
* Production Readiness;
* archivos de reporte generados.
