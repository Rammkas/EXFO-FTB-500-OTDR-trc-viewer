> Note: this is a copy of `FORMAT.md` from the **ExfoTrcAnalyzer** repository
> (https://github.com/Rammkas/EXFO-FTB-500-OTDR-.trc-Analyzer); the canonical
> version is maintained there. `otdr-parser.js` in this repository implements
> the format described below.

================================================================================
FULL DESCRIPTION OF THE .TRC FORMAT (EXFO FTB-500 / OTDR Expert)
Everything known, reverse-engineered and cross-verified on four reference
sample files (named here sample.trc, sample_02.trc, sample_03.trc,
sample_04.trc).
Compiled: 2026-11-21. Verification tool: exfo_trc_analyzer
(--file-map full/short, --dump-keys, --raw-trace, --excel-trace).
Reliability markers: [V] = verified (confirmed by numbers/cross-checks),
                     [H] = hypothesis (plausible, not proven),
                     [?] = unknown (semantics not decoded).
================================================================================

1. GENERAL
--------------------------------------------------------------------------------
1.1. .trc is a binary OTDR measurement result file, produced by the
     "OTDR Expert" software (v6.14.57.263 in the sample files) for EXFO
     FTB-500 instruments with a FTB-7200D-023B-EI module. [V]
1.2. Sample files: ~153 kB each; each contains 1 fiber (Fiber0) and
     2 traces (Trace0 = 1310 nm, Trace1 = 1550 nm). [V]
1.3. Inside is a "mess": binary service regions plus a chain of
     zlib-compressed chunks (RFC 1950). No public EXFO specification
     exists; the format was recovered empirically. [V]
1.4. Format version in the tree: OtdrData.Version = 1 (Int32). [V]

2. FILE CONTAINER (raw bytes)
--------------------------------------------------------------------------------
2.1. Record header (before EVERY chunk): 40 bytes, starting with the ASCII
     magic "AppReg Format Ex  " (18 characters, then 2 zero bytes). [V]
     int32 fields (offsets relative to the magic start): [V - observed]
       @+20 = 2  — record type [?] (always 2 in checked files)
       @+24    — total UNPACKED size of the record's data
                 (16 for record #1; 278,616 for record #2 = all 9 chunks) [V]
       @+28 = 1  — [?]
       @+32 = 0  — [?]
       @+36    — COMPRESSED size of the record's first chunk
                 (15 and 18,561) [V]
2.2. zlib chunks: CMF=0x78, FLG=0xDA (deflate, maximum level 9). [V]
     Each chunk ends with a 4-byte Adler-32 trailer (big-endian), which
     ZLibStream validates during decompression. [V]
2.3. Layout of record #2 (the data record): [V]
     - chunks #1 and #2 follow their record headers with NO prefix;
     - every chunk starting from #3 is preceded by an int32 equal to its
       compressed size (pattern confirmed in all checked files);
     - chunk end is determined reliably by two independent methods, both
       implemented in FileMap.cs: (a) the int32 four bytes before the CMF,
       accepted only when the Adler-32 checksum is found exactly at the
       predicted position; (b) scanning for the Adler-32 trailer.
2.4. Unpacked chunk sizes in sample.trc: [V]
     #01 = 16 B (skipped by the analyzer as too small, < 50 B),
     #02..#09 = 32,768 B each (exact), #10 = 16,472 B (remainder).
     Total unpacked stream = 278,616 B (excluding chunk #01), 9 chunks.
2.5. Content of chunk #01 [V - unpacked]: 16 bytes = four int32: 0, 8, 0, 0.
     A mini-manifest before the main tree; purpose [?]. Carries no
     substantive information; the analyzer ignores it (MinChunkLength=50 B).
2.6. Unpacked chunks are concatenated into one logical stream; ALL tree
     offsets are ABSOLUTE in this stream (not in the file). [V]
2.7. .NET pitfall: ZLibStream reads its input with a read-ahead buffer, so
     its Position is NOT the end of the zlib stream — you cannot "jump past"
     a decompressed chunk via Position (on .NET 8 this silently drops every
     chunk after the first). The analyzer scans CMF/FLG candidates and
     attempts decompression instead. [V]

3. NODE TREE IN THE UNPACKED STREAM
--------------------------------------------------------------------------------
3.1. Root: container "OtdrFile" (in sample.trc at unpacked offset 0x000014,
     chunk #02). Discovery: find the ASCII string "OtdrFile\0", then look
     for its absolute 4-byte offset in the stream (that is the nameOffset
     field of the node header); every candidate is verified by parsing and
     checking the name is "OtdrFile" (the first string hit may be a
     coincidence inside binary data). [V]
3.2. Every node header is 16 bytes: [V - confirmed on all 640 nodes]
     [0..4)   nameOffset   — absolute offset of the node name (ASCII,
                             NUL-terminated)
     [4..8)   dataType     — node type (see 3.3)
     [8..12)  valLen       — value area size in bytes
     [12..16) selfOffset   — absolute offset of the value area; ALWAYS
                             == offset + 16 (not used during parsing)
     The value itself starts right after the header (offset + 16).
3.3. Type codes (numbering inherited from the original Python parser and
     confirmed by counting nodes): [V]
       0 = Container  — value = table of int32 child references
                        (N children = valLen/4; 0 in the table = "no link")
       1 = Int32
       2 = BinaryRef  — binary blob (CLSID GUID 16 B; RawSamples)
       3 = Double     — NaN encodes "no value" (e.g. Loss of the input
                        connector) [V]
       4 = Utf16String — UTF-16LE, trailing NUL trimmed
       5 = Bool8      — 1-byte bool; NEVER seen in checked files (kept from
                        the Python parser) [?]
     In sample.trc: Container 39, Int32 120, BinaryRef 40, Double 362,
     Utf16String 79 — 640 nodes total, all named, none unparsable. [V]
3.4. Parser safeguards: name length capped at 256 bytes; traversal uses a
     visited set and a depth limit of 200 (cycles in a corrupted file
     cannot cause StackOverflow); odd-length UTF-16 strings are truncated;
     negative valLen is rejected.
3.5. Every container has a BinaryRef child "CLSID" (a 16-byte GUID — an
     EXFO class marker). GUID contents are not decoded [?]; they are not
     needed for analysis. In sample.trc: 38 CLSID + 2 RawSamples = 40
     BinaryRef nodes. [V]

4. TREE STRUCTURE (full outline, identical in all four sample files)
--------------------------------------------------------------------------------
OtdrFile [Container]
└─ OtdrData [Container]
   ├─ Version [Int32] = 1; CLSID [BinaryRef]; SaveSoftwareVersion [Utf16]
   └─ Fibers [Container] (Count, CLSID)
      └─ Fiber0 [Container] (15 children)
         ├─ scalars: FiberCode, Origin(=1), PortNumber(=-1) [Int32];
         │  Type, Color, Identifier, Ribbon, Cable, CableManufacturer,
         │  LocationA, LocationB, Ipid1, Ipid2 [Utf16] (empty in samples)
         └─ Traces [Container] (Count, CLSID)
            ├─ Trace0 / Trace1 [Container] (45 children; identical field
            │  set in both) [V]
            │  ├─ Trace scalars (full list and units — section 5)
            │  ├─ EventTable [Container] (Count=5 in samples; section 7)
            │  ├─ AcquisitionDatas [Container] (Count=2; section 8)
            │  │  └─ AcquisitionData0/1 [Container] (45 children),
            │  │     each with a child container AdcPatch (9 children)
            │  ├─ JobInformation [Container] (Identifier, MaintenanceReason,
            │  │  UserNameA/B, CustomerName, CompanyName — empty in samples)
            │  ├─ ModuleInformation [Container] (ModelName="FTB-7200D-023B-EI",
            │  │  ModelType="", SerialNumber=<sample-specific>,
            │  │  ManufacturingDate="27.04.2006 0:00:00", FpgaVersion,
            │  │  PcbVersion, PcbSerialNumber, ProductVersion="M",
            │  │  LastCalibrationDate, CpuPcbVersion, CpuPcbSerialNumber,
            │  │  PowerMeterVersion, PowerMeterSerialNumber)
            │  ├─ FiberSectionCharacteristics [Container] (Count=1)
            │  │  └─ Section0 {StartPosition=0; Ior=1.467 (1310) / 1.468 (1550);
            │  │     Rbs=-79.4 / -81.7 dB; HelixFactor=0;
            │  │     TypicalFiberAttenuation=0.00035 / 0.0002 dB/m;
            │  │     Min/MaxFiberAttenuation=0.00025..0.0007 /
            │  │     0.0001..0.0005 dB/m; FiberCode=0} [V]
            │  └─ SoftwareContext [Container] (ZoomOnEvent, display cursors/
            │     zooms [?]; software versions: AcquisitionSoftwareVersion=
            │     "OTDR Expert 6.14.57.263", AnalysisVersion=
            │     "OtdrAnalysis.dll 1.11.13.142", InstrumentVersion=
            │     "Instrument7000.dll 1.18.1.1", AcquisitionVersion=
            │     "Module7000D.dll 1.43.4.0") [V]

5. TRACE FIELD DICTIONARY (values from sample.trc; units:
   V = confirmed by cross-checks, H = assumed from meaning/value)
--------------------------------------------------------------------------------
  SamplingPeriod   = 3.125E-09  s; sampling period, 320 MSa/s [V]
  Wavelength       = 1.31E-06 / 1.55E-06  meters (!) — NOT nanometers [V]
  Range            = 20,000  m; full scale of the time window [V]
  RangeStart       = 1.225E-09 (1310) / 1.25E-10 (1550)  s; window start [V]
  RangeEnd         = 1.95882E-04 / 1.95881E-04  s; window end [V]
                     -> velocity implied by the distance formula (section 6):
                     2*Range/(RangeEnd-RangeStart) ≈ 2.042E8 m/s = c/n,
                     n ≈ 1.464 — fiber group velocity, consistent with
                     Ior 1.467 [V]
  Pulse            = 1E-07 s (100 ns) [H]
  Duration         = 15 s of averaging [H]
  AcquisitionOffset = 0; RealTime = 0; HighResolution = 1 [H]
  UsedAsReference = 0; ReferenceFileName = ""; RemovedUnmatchedEvents = 0;
  TemplateSuccess = 0 [H]
  SpliceLossThreshold   = 0.05 dB — splice detector threshold [H]
  ReflectanceThreshold  = -72 dB — reflection detector threshold [H]
  EndOfFiberThreshold   = 5 dB — "end of fiber" threshold [H]
  InjectionLevel        = 20.8026 / 19.9181 dB — injection level [H]
  ExpectedInjection     = 21.3376 / 20.3288 dB [H]
  InjectionCorrection   = 0; CalibratedFrontEndConnectorLoss = 0;
  FiberCInjectionLevelCorrection = -1.5 dB [H]
  RmsNoise              = 6.88257 / 7.09177 dB — trace noise [H]
  SaturationLevel       = 36.3248 dB [H]
  DisplayRange          = 38.5601 / 38.7618 (display scale, dB?) [?]
  SpansLoss             = 3.23272 / 1.97315 dB — total span loss [H]
  SpansLength           = 8349.28 / 8347.1 m — equals the fiber-end position
                          from EventTable [V]
  TotalOrl              = 32.8132 / 33.9232 dB — total optical return loss [H]
  RbsInternalModuleFiber = -79.445 / -81.866 dB — module backscatter level [H]
  ScaleFactor           = 1024 counts/dB — RawSamples value scale [V]
  ModuleTemperature = 37.5625 / ApdTemperature = 37.5625 °C [H]
  Date              = "2018-11-05T07:01:51" ISO8601 [V]
  Comment, TemplateComment = "" [V]
  CLSID, RawSamples = BinaryRef (section 6) [V]

6. RawSamples — THE MEASURED CURVE (BinaryRef blob)  [everything V]
--------------------------------------------------------------------------------
6.1. Each TraceN container holds exactly one BinaryRef "RawSamples"; the
     data starts right after the 16-byte node header and spans valLen bytes.
6.2. sample.trc: 125,364 B per trace = 62,682 Int16 little-endian samples.
6.3. Value scale: level_db = raw_int16 / ScaleFactor, ScaleFactor = 1024
     (a tree field). Verified: decoded trace slopes match the EventTable/GOLD
     attenuations (0.322 dB/km at 1310, 0.183 dB/km at 1550).
6.4. The sample axis is TIME-uniform: t_i = RangeStart + i * SamplingPeriod;
     meters: dist_i = t_i * Range / (RangeEnd - RangeStart).
     In the sample files the step is ≈ 0.3194 m per sample.
6.5. Peak cross-checks (sample.trc, 1310 nm):
     - QC connector: peak at sample 3179 (raw 29,219 -> 28.53 dB) at
       1014.45 m; EventTable says 1010.9 m. The ~3.5 m difference is normal:
       EXFO refines event positions beyond the raw sample grid.
     - fiber end: peak at sample 26,165 (raw 23,068) at 8348.61 m;
       EventTable says 8349.28 m.
6.6. The RawSamples grid equals AcquisitionData0's "used portion":
     UsedPortionEnd (Adq0) = 1.95882E-04 s == RangeEnd;
     UsedPortionStart (Adq0) == RangeStart. Exact to the last sample.
6.7. The blob carries no headers or compression — raw Int16 only.

7. EventTable — EVENTS DETECTED BY EXFO  [structure V, codes partly ?]
--------------------------------------------------------------------------------
7.1. Entries ALTERNATE: [V]
     a) "point" event (27 children): Type, Status, SubCursorA/B, CursorA/B,
        EventChanged [Int32]; Position, Length, Loss, CurveLevel, LocalNoise,
        Reflectance, PeakReflectionToRbs, DetectionProbability,
        PositionDetectionThreshold, PositionError, LossError, ReflectanceError,
        SubCursorAPosition, CursorAPosition, CursorBPosition, SubCursorBPosition
        [Double]; Comment [Utf16]; CLSID.
     b) "linear section" LMA (12 children): Position, Length, Loss,
        CursorAPosition, CursorBPosition [Double]; CursorA, CursorB,
        EventChanged [Int32]; Comment; CLSID. No Type/Reflectance.
7.2. CursorA/B and SubCursorA/B are SAMPLE INDICES of the RawSamples grid;
     CursorAPosition/... are the matching meters. Example (sample.trc, 1310):
     Event2 (QC): CursorA=3166 ↔ CursorAPosition=1010.93 m;
     Event4 (end): CursorA=26148 ↔ 8349.28 m. [V]
7.3. Observed codes (all four sample files): [V]
     Type = 3 for ALL automatic events (launch, connector, end).
     Status: 72 — launch event (Position=0, front-end connector);
             0  — regular reflection event (QC connector; Loss populated);
             132 — end-of-fiber event.
     Bit meanings of Status [?]; other Type values never seen in the samples.
7.4. Reflectance is negative dB (reflection relative to the backscatter
     level): sample.trc: -44.06 (launch), -43.39 (QC), -49.95 (end). [V]
7.5. CurveLevel — trace level at the event (dB): 20.80 / 20.47 / 17.57. [H]
7.6. Length for point events — event window width (m): 14.7 / 16.3 / 17.9. [H]
7.7. LMA sections give per-section losses: Event1: 0 -> 1010.93 m,
     Loss=0.327987 (buffer spool ~0.325 dB/km ✓); Event3: 1010.93 ->
     8349.28 m, Loss=2.3637 (fiber under test 7338.35 m ✓). [V]
7.8. NaN in Double fields means "value absent" (Loss of launch/end events,
     PeakReflectionToRbs etc.) [V].
7.9. SubCursorBPosition for point events is always CursorBPosition + 5000 m
     (a second cursor set mirrored at +5 km; purpose [?], possibly an
     artifact of the two-pass acquisition stitching).

8. AcquisitionDatas — MEASUREMENT CONDITIONS AND "STITCHING"
   [values V, algorithm ?]
--------------------------------------------------------------------------------
8.1. Every trace holds TWO AcquisitionData containers (two passes). Fields
     of each:
     Int32: GainMode, NumberOfAverages, BaseSumBits, NumberOfPhases,
     NumberOfAddedSamplesDecimation, ExcludedOffsetZoneStart/End;
     Double x36: RangeStart, RangeEnd, BaseClockPeriod, NominalPulseWidth,
     CalibratedPulseWidth, PulseRiseTime, PulseFallTime, Bandwidth,
     TypicalApdGain, TypicalAnalogGain, NominalWavelength, ExactWavelength,
     InternalModuleReflection, NormalizationExponent,
     NormalizationGainAppliedForStitch, TimeToOutputConnector,
     UsedPortionStart, UsedPortionEnd, UnfilteredRawDataRmsNoise,
     HighBandwidthFilteredRawDataRmsNoise, LowBandwidthFilteredRawDataRmsNoise,
     FresnelCorrection, SaturationLevelLinear, PulseSamplingDelay,
     HighBandwidthFilter, LowBandwidthFilter, FilterTransitionPosition,
     StitchComputationStart, StitchComputationEnd, ExpectedInjectionLinear,
     SpeckleNoiseFor10nsPulse, RepetitionPeriod, TimeFromLaserToOutputConnector,
     AnalysisDynamicRange, TransitionLevelForRecoveryCheck,
     MaximumPowerBeforeOscillationLinear;
     Utf16 + CLSID; plus a child container AdcPatch {AdcPipelinePatchTriggerLevel,
     AdcPipelinePatchDurationToApply, AdcPipelinePatchFilterBandwidth,
     RelativeGlitchAmplitude, HighSnrMaximumTraceDistortion, AdcModel}.
8.2. Observations in sample.trc (Adq0 | Adq1, same for 1310 and 1550): [V]
     GainMode 1 | 0; NumberOfAverages 4561 | 2324; NumberOfPhases 8;
     NominalPulseWidth = CalibratedPulseWidth = 1E-07 s (100 ns);
     BaseClockPeriod 2.5E-08 (25 ns); RepetitionPeriod 2.09675E-4 | 2.2185E-4;
     AnalysisDynamicRange 50 dB; FresnelCorrection 0;
     TimeToOutputConnector 2.894E-07 s (delay to the module connector);
     TimeFromLaserToOutputConnector 1.469E-07 s; SpeckleNoiseFor10nsPulse 0.05;
     AdcModel "AD9215BCP-65".
     UsedPortionStart 1.225E-9 | 1.225E-9 (1310; for 1550: 1.25E-10);
     UsedPortionEnd 1.95882E-4 | ~1.2E-9 (the second pass contributed
     nothing to the final curve); NormalizationExponent 22;
     NormalizationGainAppliedForStitch 1 | 49.437;
     StitchComputationStart = StitchComputationEnd = 0.
8.3. Conclusion: the final RawSamples curve = pass Adq0 (its UsedPortion
     equals the trace grid, gain 1); the second pass was unused in these
     measurements. EXFO's general stitching algorithm is not investigated [?];
     no practical impact — the final blob decodes consistently.

9. GOLD VALUES OF THE SAMPLE FILES (regression-test anchors)
--------------------------------------------------------------------------------
9.1. sample.trc: QC loss 0.541/0.440 dB; fiber 7338.4/7336.5 m;
     attenuation 0.322/0.183 dB/km; event positions: port 0, QC
     1010.6-1010.93 m, end 8347.1-8349.28 m. Events per trace: 5
     (3 point + 2 LMA). [V]
9.2. sample_02.trc: 7342.2/7336.5 m, 0.328/0.186 dB/km, QC 0.152/0.147 dB.
     sample_03.trc: 7340.9/7338.8 m, 0.331/0.184 dB/km, QC 0.259/0.132 dB.
     sample_04.trc: 7338.7/7336.5 m, 0.331/0.187 dB/km, QC 0.480/0.352 dB. [V]
9.3. Traces at both wavelengths match BY EVENT COORDINATES (not by index) —
     an extra/missing event at one wavelength does not shift the pairs. [V]

10. WHAT REMAINS UNKNOWN / UNVERIFIED
--------------------------------------------------------------------------------
10.1. [?] Bit semantics of Event.Status (72/0/132); Type values other than 3.
10.2. [?] Record header fields @+20=2, @+28=1, @+32=0.
10.3. [?] Purpose of chunk #01 (int32: 0, 8, 0, 0).
10.4. [?] CLSID GUID contents (class markers; not needed for analysis).
10.5. [?] The stitching algorithm for two AcquisitionData passes; fields
      StitchComputation*, ExcludedOffsetZone*, bandwidth filters,
      AdcPatch parameters.
10.6. [?] The "mirrored" SubCursor* fields (+5000 m) of point events.
10.7. [?] Units/meaning of DisplayRange, BaseSumBits,
      NumberOfAddedSamplesDecimation.
10.8. [H -> untested] Format behavior when: UsedAsReference=1 / non-empty
      ReferenceFileName (comparison-with-reference mode); several FiberN
      containers; other event kinds (splices, ghosts); HighResolution=0;
      files from other EXFO platforms (FXC/FITBuilder) or other software
      versions; empty-bench or known-bad measurements.
10.9. All four sample files share an identical structure; there is NOT a
      single node that cannot be parsed. [V]

11. FORMAT INSPECTION TOOLS (this analyzer)
--------------------------------------------------------------------------------
  --dump-keys <file>        — every parsed key/value of the tree;
  --file-map full <file>    — raw byte map + unpacked stream map + full
                              node tree + BinaryRef blobs;
  --file-map short <file>   — compact "address -> what lives there" map +
                              <name>.nodetree.json (all nodes with offsets,
                              types, sizes and parsed values);
  --raw-trace <file|folder> — point-by-point curve CSV (raw_trace_<name>.csv:
                              sample index, time, meters, Int16, dB);
  --excel-trace <file|folder> — chart-friendly CSV (trace_plot_<name>.csv:
                              1 m bins, peak-preserving max dB per bin).
================================================================================
