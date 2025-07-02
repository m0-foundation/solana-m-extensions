import { Command } from "commander";
import shell from "shelljs";
import { Keypair, PublicKey } from "@solana/web3.js";
import fs from "fs";

if (!fs.existsSync("devnet-keypair.json")) {
  throw new Error("devnet keypair not found");
}

(async function main() {
  const program = new Command();

  program
    .command("build-program")
    .option("-t, --type", "Yield type", "scaled-ui")
    .option("-e, --extension", "Extension program ID", "KAST_USDK")
    .action(({ type, extension }) => {
      const [pid] = keysFromEnv([extension]);
      const pubkey = pid.publicKey.toBase58();

      console.log(`Building extension ${pubkey}`);
      buildProgram(pubkey, type);
    });

  program
    .command("deploy-program")
    .option("-t, --type", "Yield type", "scaled-ui")
    .option("-e, --extension", "Extension program ID", "KAST_USDK")
    .option("-c, --computePrice", "Compute price", "300000")
    .action(({ type, extension, computePrice }) => {
      const [pid] = keysFromEnv([extension]);
      const pubkey = pid.publicKey.toBase58();

      console.log(`Building and deploying extension ${pubkey}`);
      buildProgram(pubkey, type);

      deployProgram(pid, parseInt(computePrice));
    });

  program
    .command("init-idl")
    .option("-t, --type", "Yield type", "scaled-ui")
    .option("-e, --extension", "Extension program ID", "KAST_USDK")
    .action(({ type, extension }) => {
      const [pid] = keysFromEnv([extension]);
      const pubkey = pid.publicKey.toBase58();

      console.log(`Building and initializing IDL for extension ${pubkey}`);
      buildProgram(pubkey, type);

      initIDL(pubkey);
    });

  program
    .command("upgrade-program")
    .option("-t, --type", "Yield type", "scaled-ui")
    .option("-e, --extension", "Extension program ID", "KAST_USDK")
    .option("-c, --computePrice", "Compute price", "300000")
    .action(({ type, extension, computePrice }) => {
      const [pid] = keysFromEnv([extension]);
      const pubkey = pid.publicKey.toBase58();

      console.log(`Building and deploying extension ${pubkey}`);
      buildProgram(pubkey, type);

      updateProgram(pubkey, parseInt(computePrice));
    });

  program
    .command("propose-upgrade-program")
    .option("-t, --type", "Yield type", "scaled-ui")
    .option("-e, --extension", "Extension program ID", "KAST_USDK")
    .option("-c, --computePrice", "Compute price", "300000")
    .option("-a, --authority", "Authority to transfer buffer to")
    .action(({ type, extension, computePrice, authority }) => {
      const [pid] = keysFromEnv([extension]);
      const pubkey = pid.publicKey.toBase58();
      const buffAuth = new PublicKey(authority);

      console.log(`Building and deploying extension ${pubkey}`);
      buildProgram(pubkey, type);

      updateProgram(pubkey, parseInt(computePrice), buffAuth);
    });

  program
    .command("upgrade-swap-program")
    .option("-c, --computePrice", "Compute price", "300000")
    .option(
      "-p, --pubkey",
      "Swap program ID",
      "MSwapi3WhNKMUGm9YrxGhypgUEt7wYQH3ZgG32XoWzH"
    )
    .action(({ computePrice, pubkey }) => {
      console.log("Building swap program...");
      shell.rm("-f", `target/verifiable/ext_swap.so`);

      const res = shell.exec("anchor build -p ext_swap --verifiable", {
        silent: true,
      });
      if (res.code !== 0) {
        throw new Error(`Buffer write failed: ${res.stderr}`);
      }

      updateProgram(pubkey, parseInt(computePrice), undefined, "ext_swap.so");
    });

  await program.parseAsync(process.argv);
})();

function setProgramID(pid: string) {
  shell.sed(
    "-i",
    /declare_id!\("[^"]*"\)/,
    `declare_id!("${pid}")`,
    "programs/m_ext/src/lib.rs"
  );
}

function buildProgram(pid: string, yieldFeature: string) {
  // remove old binary
  shell.rm("-f", "target/verifiable/m_ext.so.so");

  // set program ID to the extension program
  setProgramID(pid);

  console.log("Building the program...");

  const result = shell.exec(
    "anchor build -p m_ext --verifiable " +
      `-- --features ${yieldFeature} --no-default-features`,
    { silent: true }
  );
  if (result.code !== 0) {
    throw new Error(`Build failed: ${result.stderr}`);
  }

  // revert to default program ID
  setProgramID("3C865D264L4NkAm78zfnDzQJJvXuU3fMjRUvRxyPi5da");
}

function deployProgram(programKeypair: Keypair, computePrice: number) {
  shell.exec(`echo '[${programKeypair.secretKey}]' > pid.json`, {
    silent: true,
  });

  shell.exec(
    `solana program deploy \
      --url ${process.env.RPC_URL} \
      --with-compute-unit-price ${computePrice} \
      --keypair devnet-keypair.json \
      --max-sign-attempts 3 \
      --program-id pid.json \
      target/verifiable/m_ext.so`,
    { silent: true }
  );

  // delete the temporary pid keypair file
  shell.exec("rm pid.json");
}

function updateProgram(
  pid: string,
  computePrice: number,
  transferBufferAuth?: PublicKey,
  binaryFile = "m_ext.so"
) {
  // create a temporary buffer to write the upgrade to
  shell.exec(
    "solana-keygen new --no-bip39-passphrase --force -s --outfile=buffer.json",
    { silent: true }
  );

  const bufferAddress = shell
    .exec("solana-keygen pubkey buffer.json", { silent: true })
    .stdout.trim();

  console.log(`Buffer address: ${bufferAddress}`);

  let result = shell.exec(
    `solana program write-buffer \
      --url ${process.env.RPC_URL} \
      --with-compute-unit-price ${computePrice} \
      --keypair devnet-keypair.json \
      --max-sign-attempts 3 \
      --buffer buffer.json \
      target/verifiable/${binaryFile}`,
    { silent: true }
  );
  if (result.code !== 0) {
    throw new Error(`Buffer write failed: ${result.stderr}`);
  }

  if (transferBufferAuth) {
    console.log(
      `Transferring buffer authority to ${transferBufferAuth.toBase58()}`
    );

    // transfer the buffer authority to provided pubkey
    const result = shell.exec(
      `solana program set-buffer-authority \
        --url ${process.env.RPC_URL} \
        --keypair devnet-keypair.json \
        --buffer ${bufferAddress} \
        --new-authority ${transferBufferAuth}`,
      { silent: true }
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
      ${pid}`,
    { silent: true }
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
      -f target/idl/ext_swap.json \
      --provider.cluster ${process.env.RPC_URL}) \
      --provider.wallet devnet-keypair.json \
      ${pid}`,
    { silent: true }
  );
}

function keysFromEnv(keys: string[]) {
  return keys.map((key) =>
    Keypair.fromSecretKey(Buffer.from(JSON.parse(process.env[key]!)))
  );
}
