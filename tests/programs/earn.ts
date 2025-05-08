/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/earn.json`.
 */
export type Earn = {
  "address": "MzeRokYa9o1ZikH6XHRiSS5nD8mNjZyHpLCBRTBSY4c",
  "metadata": {
    "name": "earn",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "addRegistrarEarner",
      "discriminator": [
        76,
        77,
        185,
        48,
        251,
        203,
        63,
        190
      ],
      "accounts": [
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "globalAccount",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "userTokenAccount"
        },
        {
          "name": "earnerAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  97,
                  114,
                  110,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "userTokenAccount"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "user",
          "type": "pubkey"
        },
        {
          "name": "proof",
          "type": {
            "vec": {
              "defined": {
                "name": "proofElement"
              }
            }
          }
        }
      ]
    },
    {
      "name": "claimFor",
      "discriminator": [
        245,
        67,
        97,
        44,
        59,
        223,
        144,
        1
      ],
      "accounts": [
        {
          "name": "earnAuthority",
          "signer": true,
          "relations": [
            "globalAccount"
          ]
        },
        {
          "name": "globalAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "mint",
          "writable": true,
          "relations": [
            "globalAccount"
          ]
        },
        {
          "name": "tokenAuthorityAccount",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "userTokenAccount",
          "writable": true
        },
        {
          "name": "earnerAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  97,
                  114,
                  110,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "earner_account.user_token_account",
                "account": "earner"
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "mintMultisig"
        }
      ],
      "args": [
        {
          "name": "snapshotBalance",
          "type": "u64"
        }
      ]
    },
    {
      "name": "completeClaims",
      "discriminator": [
        125,
        214,
        249,
        213,
        173,
        230,
        32,
        109
      ],
      "accounts": [
        {
          "name": "earnAuthority",
          "signer": true,
          "relations": [
            "globalAccount"
          ]
        },
        {
          "name": "globalAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "initialize",
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "globalAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "earnAuthority",
          "type": "pubkey"
        },
        {
          "name": "initialIndex",
          "type": "u64"
        },
        {
          "name": "initialEarnerRate",
          "type": "u16"
        },
        {
          "name": "claimCooldown",
          "type": "u64"
        }
      ]
    },
    {
      "name": "propagateIndex",
      "discriminator": [
        147,
        161,
        17,
        101,
        221,
        86,
        186,
        218
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "globalAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "globalAccount"
          ]
        }
      ],
      "args": [
        {
          "name": "index",
          "type": "u64"
        },
        {
          "name": "earnerMerkleRoot",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "removeRegistrarEarner",
      "discriminator": [
        39,
        9,
        93,
        224,
        9,
        29,
        121,
        68
      ],
      "accounts": [
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "globalAccount",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "earnerAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  97,
                  114,
                  110,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "earner_account.user_token_account",
                "account": "earner"
              }
            ]
          }
        },
        {
          "name": "userTokenAccount",
          "relations": [
            "earnerAccount"
          ]
        }
      ],
      "args": [
        {
          "name": "proofs",
          "type": {
            "vec": {
              "vec": {
                "defined": {
                  "name": "proofElement"
                }
              }
            }
          }
        },
        {
          "name": "neighbors",
          "type": {
            "vec": {
              "array": [
                "u8",
                32
              ]
            }
          }
        }
      ]
    },
    {
      "name": "setClaimCooldown",
      "discriminator": [
        165,
        71,
        98,
        121,
        209,
        241,
        183,
        47
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "globalAccount"
          ]
        },
        {
          "name": "globalAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "claimCooldown",
          "type": "u64"
        }
      ]
    },
    {
      "name": "setEarnAuthority",
      "discriminator": [
        241,
        163,
        124,
        135,
        107,
        230,
        22,
        157
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "globalAccount"
          ]
        },
        {
          "name": "globalAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newEarnAuthority",
          "type": "pubkey"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "earner",
      "discriminator": [
        236,
        126,
        51,
        96,
        46,
        225,
        103,
        207
      ]
    },
    {
      "name": "global",
      "discriminator": [
        167,
        232,
        232,
        177,
        200,
        108,
        114,
        127
      ]
    }
  ],
  "events": [
    {
      "name": "indexUpdate",
      "discriminator": [
        8,
        115,
        122,
        188,
        54,
        206,
        122,
        87
      ]
    },
    {
      "name": "rewardsClaim",
      "discriminator": [
        84,
        168,
        212,
        108,
        203,
        10,
        250,
        107
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "alreadyClaimed",
      "msg": "Already claimed for user."
    },
    {
      "code": 6001,
      "name": "exceedsMaxYield",
      "msg": "Rewards exceed max yield."
    },
    {
      "code": 6002,
      "name": "notAuthorized",
      "msg": "Invalid signer."
    },
    {
      "code": 6003,
      "name": "invalidParam",
      "msg": "Invalid parameter."
    },
    {
      "code": 6004,
      "name": "alreadyEarns",
      "msg": "User is already an earner."
    },
    {
      "code": 6005,
      "name": "noActiveClaim",
      "msg": "There is no active claim to complete."
    },
    {
      "code": 6006,
      "name": "notEarning",
      "msg": "User is not earning."
    },
    {
      "code": 6007,
      "name": "requiredAccountMissing",
      "msg": "An optional account is required in this case, but not provided."
    },
    {
      "code": 6008,
      "name": "invalidAccount",
      "msg": "Account does not match the expected key."
    },
    {
      "code": 6009,
      "name": "notActive",
      "msg": "Account is not currently active."
    },
    {
      "code": 6010,
      "name": "invalidProof",
      "msg": "Merkle proof verification failed."
    },
    {
      "code": 6011,
      "name": "mutableOwner",
      "msg": "Token account owner is required to be immutable."
    }
  ],
  "types": [
    {
      "name": "earner",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "lastClaimIndex",
            "type": "u64"
          },
          {
            "name": "lastClaimTimestamp",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "userTokenAccount",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "global",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "earnAuthority",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "u64"
          },
          {
            "name": "claimCooldown",
            "type": "u64"
          },
          {
            "name": "maxSupply",
            "type": "u64"
          },
          {
            "name": "maxYield",
            "type": "u64"
          },
          {
            "name": "distributed",
            "type": "u64"
          },
          {
            "name": "claimComplete",
            "type": "bool"
          },
          {
            "name": "earnerMerkleRoot",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "portalAuthority",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "earnerRate",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "indexUpdate",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "index",
            "type": "u64"
          },
          {
            "name": "ts",
            "type": "u64"
          },
          {
            "name": "supply",
            "type": "u64"
          },
          {
            "name": "maxYield",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "proofElement",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "node",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "onRight",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "rewardsClaim",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tokenAccount",
            "type": "pubkey"
          },
          {
            "name": "recipientTokenAccount",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "ts",
            "type": "u64"
          },
          {
            "name": "index",
            "type": "u64"
          },
          {
            "name": "fee",
            "type": "u64"
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "earnerSeed",
      "type": "bytes",
      "value": "[101, 97, 114, 110, 101, 114]"
    },
    {
      "name": "globalSeed",
      "type": "bytes",
      "value": "[103, 108, 111, 98, 97, 108]"
    },
    {
      "name": "tokenAuthoritySeed",
      "type": "bytes",
      "value": "[116, 111, 107, 101, 110, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121]"
    }
  ]
};
