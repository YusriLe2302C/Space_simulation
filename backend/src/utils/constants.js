module.exports = {
  ACM: {
    MAX_DV_MS:              15,     // m/s per burn       (doc §5.1)
    MANEUVER_COOLDOWN_SEC:  600,    // s                  (doc §5.1)
    COLLISION_THRESHOLD_KM: 0.1,   // km = 100 m         (doc §3.3)
    COMM_DELAY_SEC:         10,     // s signal latency   (doc §5.4)
    DRY_MASS_KG:            500.0,  // kg                 (doc §5.1)
    PROPELLANT_KG:          50.0,   // kg                 (doc §5.1)
    WET_MASS_KG:            550.0,  // kg (dry + fuel)    (doc §5.1)
    ISP_S:                  300.0,  // s                  (doc §5.1)
    G0_M_S2:                9.80665,// m/s²               (doc §5.1)
    STATION_BOX_KM:         10.0,   // km spherical box   (doc §5.2)
  },
};

