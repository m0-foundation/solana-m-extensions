import { createFromRoot, updateInstructionsVisitor, visit } from "codama";
import { IdlV01, rootNodeFromAnchorV01 } from "@codama/nodes-from-anchor";
import { renderJavaScriptVisitor, renderRustVisitor } from "@codama/renderers";
import extSwapIdl from "../../target/idl/ext_swap.json";

function generateClients() {
  console.log("Generating clients for ext_swap...");

  // Edit the generated IDL to handle dynamic program IDs for PDA seeds on InstructionAccounts
  // This is a workaround for a current limitation in Codama.
  // See: https://github.com/codama-idl/codama/issues/607
  extSwapIdl.instructions.forEach((instruction) => {
    instruction.accounts.forEach((account) => {
      if (
        account.pda &&
        (
          account.pda as {
            program: { kind: string };
          }
        ).program
      ) {
        // If the PDA has a program defined for the seed
        // we need to update the "kind" to "const", even if it is "path"

        (account.pda as { program: { kind: string } }).program.kind = "const";
      }
    });
  });

  // Load the IDL and create a Codama instance from the root node
  const codama = createFromRoot(rootNodeFromAnchorV01(extSwapIdl as IdlV01));

  // Edit the generated IDL to handle dynamic program IDs for PDA seeds on InstructionAccounts
  // This is a workaround for a current limitation in Codama.
  // See: https://github.com/codama-idl/codama/issues/607
  // codama.update(
  //   updateInstructionsVisitor({
  //     swap: {
  //       accounts: {
  //         from_global: {
  //           pda: {
  //             program: {
  //               kind: "const",
  //               path: "from_ext_program",
  //             },
  //           },
  //         },
  //       },
  //     },
  //   })
  // );

  // Generate the JavaScript and Rust clients from the Codama instance
  const clients = [
    {
      type: "JS",
      dir: "clients/ext_swap/generated/js/src",
      renderVisitor: renderJavaScriptVisitor,
    },
    {
      type: "Rust",
      dir: "clients/ext_swap/generated/rust/src",
      renderVisitor: renderRustVisitor,
    },
  ];
  for (const client of clients) {
    try {
      codama.accept(client.renderVisitor(client.dir));
      console.log(
        `✅ Successfully generated ${client.type} client for directory: ${client.dir}!`
      );
    } catch (e) {
      console.error(`Error in ${client.renderVisitor.name}:`, e);
      throw e;
    }
  }

  // const node = rootNodeFromAnchorV01(extSwapIdl as IdlV01);

  // const clients = [
  //   {
  //     type: "JS",
  //     dir: "clients/ext_swap/generated/js/src",
  //     renderVisitor: renderJavaScriptVisitor,
  //   },
  //   {
  //     type: "Rust",
  //     dir: "clients/ext_swap/generated/rust/src",
  //     renderVisitor: renderRustVisitor,
  //   },
  // ];

  // for (const client of clients) {
  //   try {
  //     visit(node, client.renderVisitor(client.dir));
  //     console.log(
  //       `✅ Successfully generated ${client.type} client for directory: ${client.dir}!`
  //     );
  //   } catch (e) {
  //     console.error(`Error in ${client.renderVisitor.name}:`, e);
  //     throw e;
  //   }
  // }
}

generateClients();
