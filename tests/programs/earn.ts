/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/earn.json`.
 */
export type Earn = {
  address: "mz2vDzjbQDUDXBH6FPF5s4odCJ4y8YLE5QWaZ8XdZ9Z";
  metadata: {
    name: "earn";
    version: "0.2.0";
    spec: "0.1.0";
    description: "Earner management and yield distribution program for M";
  };
  instructions: [
    {
      name: "addRegistrarEarner";
      discriminator: [76, 77, 185, 48, 251, 203, 63, 190];
      accounts: [
        {
          name: "signer";
          writable: true;
          signer: true;
        },
        {
          name: "globalAccount";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [103, 108, 111, 98, 97, 108];
              }
            ];
          };
        },
        {
          name: "mMint";
          relations: ["globalAccount"];
        },
        {
          name: "userTokenAccount";
          writable: true;
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "tokenProgram";
          address: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
        }
      ];
      args: [
        {
          name: "user";
          type: "pubkey";
        },
        {
          name: "proof";
          type: {
            vec: {
              defined: {
                name: "proofElement";
              };
            };
          };
        }
      ];
    },
    {
      name: "initialize";
      discriminator: [175, 175, 109, 31, 13, 152, 155, 237];
      accounts: [
        {
          name: "admin";
          writable: true;
          signer: true;
        },
        {
          name: "globalAccount";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [103, 108, 111, 98, 97, 108];
              }
            ];
          };
        },
        {
          name: "mMint";
          writable: true;
        },
        {
          name: "portalTokenAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
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
                ];
              }
            ];
            program: {
              kind: "const";
              value: [
                11,
                134,
                236,
                24,
                28,
                212,
                197,
                201,
                132,
                233,
                6,
                43,
                19,
                242,
                178,
                222,
                123,
                159,
                91,
                94,
                104,
                232,
                67,
                73,
                35,
                29,
                102,
                20,
                205,
                243,
                249,
                159
              ];
            };
          };
        },
        {
          name: "extSwapGlobal";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [103, 108, 111, 98, 97, 108];
              }
            ];
            program: {
              kind: "const";
              value: [
                5,
                60,
                242,
                167,
                56,
                11,
                17,
                54,
                97,
                114,
                227,
                114,
                39,
                167,
                101,
                13,
                161,
                190,
                235,
                218,
                112,
                220,
                127,
                89,
                126,
                174,
                151,
                23,
                37,
                130,
                35,
                190
              ];
            };
          };
        },
        {
          name: "portalMAccount";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "account";
                path: "portalTokenAuthority";
              },
              {
                kind: "account";
                path: "tokenProgram";
              },
              {
                kind: "account";
                path: "mMint";
              }
            ];
            program: {
              kind: "const";
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ];
            };
          };
        },
        {
          name: "extSwapMAccount";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "account";
                path: "extSwapGlobal";
              },
              {
                kind: "account";
                path: "tokenProgram";
              },
              {
                kind: "account";
                path: "mMint";
              }
            ];
            program: {
              kind: "const";
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ];
            };
          };
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "tokenProgram";
          address: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
        },
        {
          name: "associatedTokenProgram";
          address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
        }
      ];
      args: [
        {
          name: "currentIndex";
          type: "u64";
        }
      ];
    },
    {
      name: "propagateIndex";
      discriminator: [147, 161, 17, 101, 221, 86, 186, 218];
      accounts: [
        {
          name: "signer";
          signer: true;
        },
        {
          name: "globalAccount";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [103, 108, 111, 98, 97, 108];
              }
            ];
          };
        },
        {
          name: "mMint";
          writable: true;
          relations: ["globalAccount"];
        },
        {
          name: "tokenProgram";
          address: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
        }
      ];
      args: [
        {
          name: "index";
          type: "u64";
        },
        {
          name: "earnerMerkleRoot";
          type: {
            array: ["u8", 32];
          };
        }
      ];
    },
    {
      name: "removeRegistrarEarner";
      discriminator: [39, 9, 93, 224, 9, 29, 121, 68];
      accounts: [
        {
          name: "signer";
          writable: true;
          signer: true;
        },
        {
          name: "globalAccount";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [103, 108, 111, 98, 97, 108];
              }
            ];
          };
        },
        {
          name: "mMint";
          relations: ["globalAccount"];
        },
        {
          name: "userTokenAccount";
          docs: [
            "We originally allowed this account to be validated later and potentially be closed,",
            "but this is not necessary anymore since if the account is closed, it will be frozen",
            "when re-initialized. Therefore, closing a token account is equivalent to removing an earner.",
            "For this reason, we also know that if there is a thawed token account, it went through the",
            "add registrar earner flow and thus the owner is the original since we required it to be immutable."
          ];
          writable: true;
        },
        {
          name: "tokenProgram";
          address: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
        }
      ];
      args: [
        {
          name: "proofs";
          type: {
            vec: {
              vec: {
                defined: {
                  name: "proofElement";
                };
              };
            };
          };
        },
        {
          name: "neighbors";
          type: {
            vec: {
              array: ["u8", 32];
            };
          };
        }
      ];
    }
  ];
  accounts: [
    {
      name: "earnGlobal";
      discriminator: [229, 50, 25, 132, 207, 93, 185, 23];
    }
  ];
  events: [
    {
      name: "indexUpdate";
      discriminator: [8, 115, 122, 188, 54, 206, 122, 87];
    }
  ];
  errors: [
    {
      code: 6000;
      name: "alreadyClaimed";
      msg: "Already claimed for user.";
    },
    {
      code: 6001;
      name: "exceedsMaxYield";
      msg: "Rewards exceed max yield.";
    },
    {
      code: 6002;
      name: "notAuthorized";
      msg: "Invalid signer.";
    },
    {
      code: 6003;
      name: "invalidParam";
      msg: "Invalid parameter.";
    },
    {
      code: 6004;
      name: "alreadyEarns";
      msg: "User is already an earner.";
    },
    {
      code: 6005;
      name: "noActiveClaim";
      msg: "There is no active claim to complete.";
    },
    {
      code: 6006;
      name: "notEarning";
      msg: "User is not earning.";
    },
    {
      code: 6007;
      name: "requiredAccountMissing";
      msg: "An optional account is required in this case, but not provided.";
    },
    {
      code: 6008;
      name: "invalidAccount";
      msg: "Account does not match the expected key.";
    },
    {
      code: 6009;
      name: "notActive";
      msg: "Account is not currently active.";
    },
    {
      code: 6010;
      name: "invalidProof";
      msg: "Merkle proof verification failed.";
    },
    {
      code: 6011;
      name: "mutableOwner";
      msg: "Token account owner is required to be immutable.";
    },
    {
      code: 6012;
      name: "invalidMint";
      msg: "Invalid Mint.";
    },
    {
      code: 6013;
      name: "mathOverflow";
      msg: "Math overflow error.";
    },
    {
      code: 6014;
      name: "mathUnderflow";
      msg: "Math underflow error.";
    },
    {
      code: 6015;
      name: "typeConversionError";
      msg: "Type conversion error.";
    }
  ];
  types: [
    {
      name: "earnGlobal";
      type: {
        kind: "struct";
        fields: [
          {
            name: "admin";
            type: "pubkey";
          },
          {
            name: "mMint";
            type: "pubkey";
          },
          {
            name: "portalAuthority";
            type: "pubkey";
          },
          {
            name: "extSwapGlobalAccount";
            type: "pubkey";
          },
          {
            name: "earnerMerkleRoot";
            type: {
              array: ["u8", 32];
            };
          },
          {
            name: "bump";
            type: "u8";
          }
        ];
      };
    },
    {
      name: "indexUpdate";
      type: {
        kind: "struct";
        fields: [
          {
            name: "index";
            type: "u64";
          },
          {
            name: "ts";
            type: "i64";
          }
        ];
      };
    },
    {
      name: "proofElement";
      type: {
        kind: "struct";
        fields: [
          {
            name: "node";
            type: {
              array: ["u8", 32];
            };
          },
          {
            name: "onRight";
            type: "bool";
          }
        ];
      };
    }
  ];
  constants: [
    {
      name: "globalSeed";
      type: "bytes";
      value: "[103, 108, 111, 98, 97, 108]";
    }
  ];
};
