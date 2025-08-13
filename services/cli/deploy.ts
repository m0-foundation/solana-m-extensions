import { Command } from "commander";
import shell from "shelljs";
import { Keypair, PublicKey } from "@solana/web3.js";
import fs from "fs";

if (!fs.existsSync("devnet-keypair.json")) {
  throw new Error("devnet keypair not found");
}

const opts: shell.ExecOptions & { async: false } = {
  silent: true,
  async: false,
};

(async function main() {
  const program = new Command();

  program
    .command("deploy-program")
    .option("-t, --type <type>", "Yield type", "scaled-ui")
    .option("-e, --extension <name>", "Extension program ID", "USDK")
    .option("-c, --computePrice <number>", "Compute price", "300000")
    .action(({ type, extension, computePrice }) => {
      const [pid] = keysFromEnv([extension]);
      const pubkey = pid.publicKey.toBase58();

      console.log(`Building and deploying extension ${pubkey} (${type})`);

      buildProgram(pubkey, type);
      deployProgram(pid, parseInt(computePrice));
    });

  program
    .command("transfer-upgrade-auth")
    .argument("programID")
    .action((programID) => {
      const pid = new PublicKey(programID);

      const result = shell.exec(
        `solana program set-upgrade-authority \
          ${pid.toBase58()} \
          --new-upgrade-authority ${process.env.SQUADS_MULTISIG} \
          --skip-new-upgrade-authority-signer-check \
          --keypair devnet-keypair.json \
          --url ${process.env.RPC_URL}`,
        opts
      );
      if (result.code !== 0) throw new Error(`Build failed: ${result.stderr}`);

      console.log(`Upgrade authority set\n${result.stdout}`);
    });

  program
    .command("init-idl")
    .option("-t, --type <type>", "Yield type", "scaled-ui")
    .option("-e, --extension <name>", "Extension program ID", "USDKY")
    .action(({ type, extension }) => {
      const [pid] = keysFromEnv([extension]);
      const pubkey = pid.publicKey.toBase58();

      console.log(`Building and initializing IDL for extension ${pubkey}`);

      buildProgram(pubkey, type);
      initIDL(pubkey);
    });

  program
    .command("upgrade-program")
    .option("-t, --type <type>", "Yield type", "scaled-ui")
    .option("-e, --extension <name>", "Extension program ID", "USDK")
    .option("-c, --computePrice <number>", "Compute price", "300000")
    .option("-s, --swapProgram", "Update swap program", false)
    .option("-a, --squadsAuth", "If Squads multisig is the auth", false)
    .option("-b, --skipBuild", "Skip build and deploy", false)
    .option("-m, --migrate", "Include migrate feature", false)
    .action(
      ({
        type,
        extension,
        migrate,
        computePrice,
        swapProgram,
        squadsAuth,
        skipBuild,
      }) => {
        const [pid] = keysFromEnv([extension]);
        const pubkey = pid.publicKey.toBase58();

        if (!skipBuild) buildProgram(pubkey, type, migrate, swapProgram);
        updateProgram(pubkey, parseInt(computePrice), squadsAuth, swapProgram);
      }
    );

  program
    .command("verify-pda-txn")
    .option("-t, --type <type>", "Yield type", "scaled-ui")
    .option("-e, --extension <name>", "Extension program ID", "USDK")
    .option(
      "-h, --hash <name>",
      "Commit hash",
      "88a692239f1c336d412d591c78bbf31043ad0af2"
    )
    .action(({ type, extension, hash }) => {
      const [pid] = keysFromEnv([extension]);
      const pubkey = pid.publicKey.toBase58();
      verifyPdaTransaction(pubkey, type, hash);
    });

  program
    .command("submit-verify-job")
    .option("-e, --extension <name>", "Extension program ID", "USDK")
    .action(({ type, extension, hash }) => {
      const [pid] = keysFromEnv([extension]);
      const pubkey = pid.publicKey.toBase58();

      const result = shell.exec(
        `solana-verify remote submit-job \ 
          --program-id ${pubkey} \ 
          --uploader ${process.env.SQUADS_MULTISIG}`,
        opts
      );

      console.log(`Submit verify job: ${result.stdout}`);
    });

  await program.parseAsync(process.argv);
})();

function buildProgram(
  pid: string,
  yieldFeature: string,
  includeMigrate = false,
  swapProgram = false
) {
  // remove old binary
  shell.rm("-f", "target/verifiable/m_ext.so");
  shell.rm("-f", "target/verifiable/ext_swap.so");

  // not building an extension
  if (swapProgram) {
    console.log("Building swap program...");
    const res = shell.exec(
      `anchor build -p ext_swap --verifiable ${
        includeMigrate ? "-- --features migrate" : ""
      }`,
      opts
    );
    if (res.code !== 0) throw new Error(`Swap build failed: ${res.stderr}`);
    return;
  }

  // set program ID to the extension program
  setProgramID(pid);

  // set program ID in referenced v1 IDL
  for (const file of [
    "programs/m_ext/idls/m_ext_v1_no_yield.json",
    "programs/m_ext/idls/m_ext_v1_scaled_ui.json",
  ]) {
    const idl = JSON.parse(fs.readFileSync(file, "utf-8"));
    idl.address = pid;
    fs.writeFileSync(file, JSON.stringify(idl, null, 2));
  }

  console.log(`Building extension program ${pid}...`);

  const result = shell.exec(
    `anchor build -p m_ext --verifiable -- --features ${yieldFeature}${
      includeMigrate ? ",migrate" : ""
    }${
      pid === "wMXX1K1nca5W4pZr1piETe78gcAVVrEFi9f4g46uXko" ? ",wm" : ""
    } --no-default-features`,
    opts
  );
  if (result.code !== 0) {
    throw new Error(`Build failed: ${result.stderr}`);
  }

  // revert to default program ID
  setProgramID("3C865D264L4NkAm78zfnDzQJJvXuU3fMjRUvRxyPi5da");
}

function deployProgram(programKeypair: Keypair, computePrice: number) {
  shell.exec(`echo '[${programKeypair.secretKey}]' > pid.json`, opts);

  const result = shell.exec(
    `solana program deploy \
      --url ${process.env.RPC_URL} \
      --with-compute-unit-price ${computePrice} \
      --keypair devnet-keypair.json \
      --max-sign-attempts 3 \
      --program-id pid.json \
      target/verifiable/m_ext.so`,
    opts
  );

  // delete the temporary pid keypair file
  shell.exec("rm pid.json");

  if (result.code !== 0) {
    throw new Error(`Deploy failed: ${result.stderr}`);
  }

  console.log(`Deployed program: ${result.stdout}`);
}

function updateProgram(
  pid: string,
  computePrice: number,
  squadsAuth = false,
  swapProgram = false
) {
  // create a temporary buffer to write the upgrade to
  shell.exec(
    "solana-keygen new --no-bip39-passphrase --force -s --outfile=buffer.json",
    opts
  );

  const bufferAddress = shell
    .exec("solana-keygen pubkey buffer.json", opts)
    .stdout.trim();

  console.log(`Buffer address: ${bufferAddress}`);

  let result = shell.exec(
    `solana program write-buffer \
      --url ${process.env.RPC_URL} \
      --with-compute-unit-price ${computePrice} \
      --keypair devnet-keypair.json \
      --max-sign-attempts 3 \
      --buffer buffer.json \
      target/verifiable/${swapProgram ? "ext_swap" : "m_ext"}.so`,
    opts
  );
  if (result.code !== 0) {
    throw new Error(`Buffer write failed: ${result.stderr}`);
  }

  if (squadsAuth) {
    const auth = process.env.SQUADS_MULTISIG;
    console.log(`Transferring buffer authority to ${auth}`);

    // transfer the buffer authority to provided pubkey
    const result = shell.exec(
      `solana program set-buffer-authority \
        --url ${process.env.RPC_URL} \
        --keypair devnet-keypair.json \
        --new-buffer-authority ${auth} \ 
         ${bufferAddress} `,
      opts
    );
    if (result.code !== 0) {
      throw new Error(`Set buffer authority failed: ${result.stderr}`);
    }

    return;
  }

  // upgrade the program with the new buffer
  result = shell.exec(
    `solana program upgrade \
      --url ${process.env.RPC_URL} \
      --keypair devnet-keypair.json \
      ${bufferAddress} \
      ${swapProgram ? "MSwapi3WhNKMUGm9YrxGhypgUEt7wYQH3ZgG32XoWzH" : pid}`,
    opts
  );
  if (result.code !== 0) {
    throw new Error(`Upgrade failed: ${result.stderr}`);
  }

  console.log("Program updated");

  // delete the temporary buffer file
  shell.exec("rm buffer.json");
}

function initIDL(pid: string) {
  shell.exec(
    `anchor idl init \
      -f target/idl/m_ext.json \
      --provider.cluster ${process.env.RPC_URL} \
      --provider.wallet devnet-keypair.json \
      ${pid}`,
    opts
  );
}

function verifyPdaTransaction(
  pid: string,
  yieldFeature: string,
  commitHash: string,
  libraryName = "m_ext"
) {
  const result = shell.exec(
    `solana-verify export-pda-tx \
      -u ${process.env.RPC_URL} \ 
      --program-id ${pid} \
      https://github.com/m0-foundation/solana-extensions --library-name ${libraryName} \ 
      --commit-hash ${commitHash} \
      --uploader ${process.env.SQUADS_MULTISIG} \
      -- --features ${yieldFeature} --no-default-features`,
    opts
  );

  console.log(`PDA verification transaction: ${result.stdout}`);
}

function setProgramID(pid: string) {
  shell.sed(
    "-i",
    /declare_id!\("[^"]*"\)/,
    `declare_id!("${pid}")`,
    "programs/m_ext/src/lib.rs"
  );
}

function keysFromEnv(keys: string[]) {
  return keys.map((key) =>
    Keypair.fromSecretKey(Buffer.from(JSON.parse(process.env[key]!)))
  );
}
