# Original User Request

## Initial Request — 2026-06-07T20:58:19Z

# Teamwork Project Prompt — Draft

> Status: Ready for launch — awaiting user approval
> Goal: Craft prompt → get user approval → delegate to teamwork_preview

Construire la couche "Controlled Library Intake" (v0.9) pour AgentMemory Hub. L'objectif est de permettre aux agents externes de proposer des mémoires sans jamais muter directement le graphe principal, via un sas de validation (Intake Queue) nécessitant une promotion humaine/explicite.

Working directory: C:/Users/micha/OneDrive/Documents/Playground/agentmemory-hub
Integrity mode: development

## Requirements

### R1. Modèle de Données Intake (Intake Queue)
Créer une nouvelle table SQLite (ex: `intake_proposals`) indépendante des tables `entities` et `relations`.
Le modèle de proposition doit inclure : `id`, `tenant`, `namespace`, `proposedBy`, `sourceClient`, `content`, `suggestedEntities` (JSON), `suggestedRelations` (JSON), `provenance`, `confidence`, `riskFlags`, `status` (valeurs: `proposed`, `quarantined`, `approved`, `rejected`, `promoted`), `createdAt`, `reviewedAt`.

### R2. Outils de Soumission MCP (External Intake)
Exposer un ou plusieurs outils MCP (ex: `agentmemory_submit_proposal`) permettant aux clients (Claude Desktop) de soumettre une proposition.
- **Validateur intégré :** refuse payload vide, namespace/tenant invalide, détecte payload trop long, détecte doublons probables, détecte relations sans entités cibles. Retourne des warnings contrôlés au lieu de crashs.
- **Contrainte absolue :** L'outil ne fait qu'insérer dans le sas (`status = 'proposed'`). Aucune mutation du graphe canonique.

### R3. API de Review & Promotion (Admin Only)
Créer une API de Review (implémentée via des fonctions internes TS et exposée idéalement via des scripts CLI ou une interface d'administration locale isolée des clients MCP) permettant de :
- Lister les propositions en attente (`list pending proposals`).
- Lire une proposition (`read proposal`).
- Approuver/Rejeter une proposition (`approve/reject proposal`).
- Promouvoir une proposition approuvée vers le graphe principal (`promote approved proposal`).
- Une proposition rejetée ne peut pas être promue. 

### R4. Contraintes Environnementales et de Sécurité
- **Local-only :** Aucun appel réseau, aucun LLM externe, aucun worker.
- **Sécurité :** Aucun accès aux secrets, aucun outil shell/file/write exposé via le serveur MCP externe.
- **Transparence :** La provenance et l'audit trail doivent être préservés lors de la promotion vers le graphe.

## Acceptance Criteria

### Tests Programmatifs (`tests/intake.test.ts`)
- [ ] Test : une proposition valide est acceptée dans le sas (statut `proposed`).
- [ ] Test : une proposition invalide (payload vide, mauvaise taille, namespace invalide) est bloquée par le validateur avec des warnings.
- [ ] Test : détection des doublons suspects.
- [ ] Test : un statut `rejected` empêche catégoriquement la promotion.
- [ ] Test : une soumission MCP (`proposed`) ne mute jamais directement le graphe principal (vérification que le graphe reste intact).
- [ ] Test : une proposition `approved` peut être promue *uniquement* via la fonction explicite de promotion, qui migre correctement les données vers les tables `entities`/`relations` en préservant l'audit/provenance.
- [ ] Le `npm test` doit réussir à 100%.

### Exemples d'Exécution CLI
- [ ] Des scripts utilitaires (ex: `scripts/intake-review.ps1`) démontrent : une proposition acceptée, une rejetée, et une promotion approuvée avec succès.
