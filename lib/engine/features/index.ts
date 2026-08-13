/**
 * T3 ENGINE. The feature spine's public surface, kept deliberately narrow.
 *
 * THE RUNTIME EXPORTS OF THIS FILE ARE: `featuresAsOf`, `detectLeakage`, two readers over an
 * already-firewalled set, and the closed vocabularies other lanes render. There is no export
 * that returns a raw observation and no export that touches a `FeatureSource`. A caller who
 * wants a feature value has exactly one function available to them, which is the point: two
 * code paths for features is how leakage ships invisibly.
 *
 * The port crosses this boundary as a TYPE ONLY. Adapters (a database reader, a fixture, a
 * replay file) must be able to implement `FeatureSource`, and a type is erased at runtime, so
 * exporting it hands nobody a way to read around the firewall.
 *
 * If you are here because you want "just the raw rows, quickly": that is the second path, and
 * the answer is no. Widen `FeatureDefinition` or add a feature instead.
 */

export { detectLeakage, featureValue, featuresAsOf, sourceClassOf } from './as-of'

export {
  ENTITY_KINDS,
  FEATURE_AVAILABILITY,
  PROVENANCE_GRADES,
  REFUSAL_REASONS,
  SOURCE_CLASSES,
  SOURCE_CLASS_DEFAULT,
  SOURCE_CLASS_FEATURE,
} from './types'

export type {
  AvailableFeatureValue,
  DataGap,
  EntityKind,
  FeatureAvailability,
  FeatureContext,
  FeatureDefinition,
  FeatureEntity,
  FeatureObservation,
  FeatureScalar,
  FeatureSet,
  FeatureSource,
  FeatureValue,
  LeakageReport,
  LeakageViolation,
  ProvenanceGrade,
  PublicationWindow,
  RefusalReason,
  RefusedObservation,
  SourceClass,
  SourceLocator,
  UnavailableFeatureValue,
  WithheldObservation,
} from './types'
