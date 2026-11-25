import { Foot } from "@/components/Foot";
import { Mark } from "@/components/Mark";
import { withBase } from "@/lib/basePath";
import { loadDesk } from "@/lib/server/chain";
import { SEAT_RISK, TRADE_RISK } from "@/lib/sign";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "权限说明 · 身份配额曲线",
  description: "工厂、曲线、池和代币没有 owner，不能暂停，也不能改参数。本产品不承诺收益。",
};

export default async function RightsPage() {
  const desk = await loadDesk("lin", null);
  return (
    <main className="frame">
      <header className="top">
        <a className="brand" href={withBase("/")}>
          <Mark />
          <span>Census Curve</span>
        </a>
        <nav className="nav">
          <a href="https://x.com/censuscurve" target="_blank" rel="noreferrer">
            官号
          </a>
          <a href={withBase("/")}>第一册</a>
          <a href={withBase("/seat")}>第二册</a>
          <a href={withBase("/rights")}>权限说明</a>
          <a href={withBase("/deploy")}>部署</a>
        </nav>
      </header>
      <section className="rights">
        <p className="kicker">PERMISSIONS</p>
        <h1>权限说明</h1>
        <p>
          本页说的是现在这组已部署合约里有没有管理员权限，不是口头承诺。任何人都可以对照仓库里的源码和区块浏览器核对。下面每一条都先对照过源码，再写下来。
        </p>

        <h2>工厂没有 owner</h2>
        <p>
          <code>CensusCurveFactory</code> 和 <code>CensusFactoryBase</code> 里没有 owner、没有 onlyOwner、没有暂停、没有改参数的函数，也不能升级。构造时只检查链号必须是 56。公开可调用的是 <code>create</code>，而且调用者必须持有 Agent ID。没有把合约里的资金提走的函数。
        </p>

        <h2>曲线没有调参，也不能单独提款</h2>
        <p>
          <code>CensusCurve</code> 的计价参数 slope、base、quota0 在构造时写入，之后没有 setter。没有暂停。公开动作是铸造和卖回。合约里的 BNB 只会作为铸造时多付的退款，或卖回时的赎回，打给这一笔的付款人。没有管理员提款函数。
        </p>

        <h2>池子没有管理员提款</h2>
        <p>
          <code>CensusPool</code> 只有兑换、加入流动性和取出流动性。手续费按 997/1000 留在池里。代币和 BNB 只会在兑换、取出或多余部分退回时打给这一笔的付款人。没有 pause、没有 owner、没有 rescue 或 withdraw。
        </p>

        <h2>代币不能在曲线外增发</h2>
        <p>
          <code>CensusToken</code> 的 <code>mint</code> 和 <code>burn</code> 只允许曲线调用。工厂只能在创建当笔把曲线和池的地址写进去一次。事件里的 owner 只是 ERC-20 授权关系里的持有人，不是管理员。没有额外的铸币权，也没有从本合约提走别人资金的函数。
        </p>

        <h2>第一册的风险</h2>
        <p>{TRADE_RISK}</p>
        <p>
          失去 Agent ID 之后，已放入池子的份额可能取不出来，这是资格规则，不是另外一个管理员开关。本页列出的合约不能替你暂停、改价或把资金提出来。
        </p>

        <h2>第二册工厂同样没有 owner</h2>
        <p>
          <code>TurnSeatFactory</code> 只在链号 56 上构造，注册表写死为同一份 Agent ID。没有 owner，没有暂停，没有改参数，也没有把资金提出去的函数。<code>create</code> 的调用者必须当时持有 Agent ID。测试用的工厂替身不是发行字节码。
        </p>

        <h2>席位册按块计价，不能改</h2>
        <p>
          <code>TurnSeatBook</code> 的窗口是 160 块，开册保护是 16 块，一册 100 席，地板从 0.0015 BNB 起、每席加 0.001 BNB。节拍只用区块高度。第 0 块是 2 倍地板，第 159 块是地板。每次只铸 1 整枚。一个 tokenId 整册只能入席一次。卖回至少 1 整枚，退的是曲线积分，不退打进死地址的溢价，也不把席位让出来。合约要 <code>ownerOf(agentId)</code> 等于这一笔的付款人。没有管理员提款。
        </p>

        <h2>第二册池子按份额取出</h2>
        <p>
          <code>TurnSeatPool</code> 的手续费从 30 bps 起，同一块里每多一笔增加，上限 100 bps。当前窗口的席位本人不加这笔拥挤费，其他已核验的地址只加一半。计数按区块高度保存，下一块回到 30 bps。流动性按内部份额记账，取出时按份额从两侧储备拿回。份额不能转给别人。没有 pause，没有 owner，没有单独提走储备的函数。
        </p>

        <h2>交易页不展开的规则</h2>
        <p>
          第一册起价 0.001 BNB，每枚加 0.001 BNB，首册 100 枚。铸造和卖回少于 0.001 枚不提交。卖回不恢复铸额。资格只认这一笔的付款人。网页连上普通插件钱包不算登录。本站不代签，不收配对码，不登录 Agentic Wallet。
        </p>
        <p>
          第二册 160 块一窗，开册后 16 块不能入席。第 0 块是 2 倍地板，第 159 块是地板。一次铸 1 整枚。一个 Agent ID 一席。高出地板的部分进死地址。卖回不退溢价，也不让出席位。拥挤费从 30 bps 到 100 bps：当前席位不加，其他已核验地址加一半，下一块回到 30。衰减到地板的那一块，持有 Agent ID 的构建者按同样的规则买下。格子标已过、当前、未到。保护期 16 格，开窗后 160 格。
        </p>

        <h2>第二册的风险</h2>
        <p>{SEAT_RISK}</p>
        <p>
          衰减到地板的那一块，构建者如果自己持有 Agent ID，可以和别人一样把它买下。这不是管理员权限，合约里没有给构建者留的开关。气费另计，不写进席位价格。
        </p>
      </section>
      <Foot
        factory={desk.local?.factory}
        token={desk.local?.token}
        curve={desk.local?.curve}
        pool={desk.local?.pool}
      />
    </main>
  );
}
